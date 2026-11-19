/**
 * The TIFF reader: the 8-byte header and the chain of image file directories (IFDs), one per page, and from each
 * IFD only the tags the coder needs. No image data is read here; ./tiff.ts reads the strips.
 *
 * The layout is the one RFC 3949 section 2.1.1 describes: two bytes of byte order ("II" or "MM"), the number
 * 42, the offset of the first IFD, and in each IFD a count of 12-byte entries followed by the offset of the
 * next IFD, 0 after the last. BigTIFF (43 in place of 42) is recognised and not read.
 *
 * A hostile or damaged file cannot make it loop or read past the end: every offset is checked against the
 * length before it is used, an IFD already visited ends the chain, at most `maxPages` IFDs are read (one more
 * is only looked at, to say the file is longer), and at most MAX_VALUES values of one tag are read.
 */

export const TAGS = {
  imageWidth: 256,
  imageLength: 257,
  bitsPerSample: 258,
  compression: 259,
  photometric: 262,
  fillOrder: 266,
  xResolution: 282,
  yResolution: 283,
  t4Options: 292,
  t6Options: 293,
  resolutionUnit: 296,
} as const

/** The most values of one tag that are read. BitsPerSample has one per sample: a colour image has three or four. */
export const MAX_VALUES = 8

export interface Rational {
  num: number
  den: number
}

export interface TiffPage {
  /** 1 for the first IFD of the chain. */
  number: number
  width?: number
  length?: number
  bitsPerSample?: number[]
  compression?: number
  t4Options?: number
  t6Options?: number
  photometric?: number
  fillOrder?: number
  xResolution?: Rational
  yResolution?: Rational
  resolutionUnit?: number
  /** Tags the IFD names but whose values could not be read: out of the file, the wrong type, or 0 as a denominator. */
  unreadable: number[]
}

export type Damage = 'loop' | 'outside' | 'truncated' | 'empty-ifd'

export interface TiffResult {
  byteOrder: 'II' | 'MM'
  pages: TiffPage[]
  /** True when the file has more IFDs than `maxPages`: the count is then "more than maxPages". */
  more: boolean
  /** Why the chain ended before a next-IFD offset of 0, after the pages in `pages`. Null when it ended normally. */
  damage: Damage | null
}

export type TiffError = 'not-tiff' | 'bigtiff' | 'damaged'
export class TiffReadError extends Error {
  readonly kind: TiffError
  readonly damage: Damage | null
  constructor(kind: TiffError, damage: Damage | null = null) {
    super(kind)
    this.kind = kind
    this.damage = damage
  }
}

/** The size in bytes of one value of each TIFF field type the reader takes: BYTE, SHORT, LONG, RATIONAL. */
const SIZES: Record<number, number> = { 1: 1, 3: 2, 4: 4, 5: 8 }

const WANTED = new Set<number>(Object.values(TAGS))

export function readTiff(bytes: Uint8Array, maxPages: number): TiffResult {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const size = bytes.byteLength
  if (size < 8) throw new TiffReadError('not-tiff')
  const order = String.fromCharCode(bytes[0] as number, bytes[1] as number)
  if (order !== 'II' && order !== 'MM') throw new TiffReadError('not-tiff')
  const little = order === 'II'
  const u16 = (at: number) => view.getUint16(at, little)
  const u32 = (at: number) => view.getUint32(at, little)
  const magic = u16(2)
  if (magic === 43) throw new TiffReadError('bigtiff')
  if (magic !== 42) throw new TiffReadError('not-tiff')

  const pages: TiffPage[] = []
  const seen = new Set<number>()
  let offset = u32(4)
  let damage: Damage | null = null
  let more = false
  while (offset !== 0) {
    // An IFD is at least its count, one entry and the next offset. One past the limit is looked at, not read.
    if (seen.has(offset)) {
      damage = 'loop'
      break
    }
    if (offset + 2 > size) {
      damage = 'outside'
      break
    }
    const count = u16(offset)
    if (count === 0) {
      damage = 'empty-ifd'
      break
    }
    if (offset + 2 + count * 12 + 4 > size) {
      damage = 'truncated'
      break
    }
    if (pages.length === maxPages) {
      more = true
      break
    }
    seen.add(offset)
    pages.push(readIfd(view, little, size, offset, count, pages.length + 1))
    offset = u32(offset + 2 + count * 12)
  }
  if (!pages.length) throw new TiffReadError('damaged', damage ?? 'empty-ifd')
  return { byteOrder: order, pages, more, damage }
}

function readIfd(view: DataView, little: boolean, size: number, at: number, count: number, number: number): TiffPage {
  const page: TiffPage = { number, unreadable: [] }
  // When a tag is repeated, the first entry counts, as Pillow reads it: a width of 60000 then 1728 is 60000 wide.
  const first = new Map<number, number>()
  for (let i = 0; i < count; i++) {
    const tag = view.getUint16(at + 2 + i * 12, little)
    if (WANTED.has(tag) && !first.has(tag)) first.set(tag, at + 2 + i * 12)
  }
  for (const [tag, entry] of first) {
    const type = view.getUint16(entry + 2, little)
    const n = view.getUint32(entry + 4, little)
    const width = SIZES[type]
    if (!width || n === 0) {
      page.unreadable.push(tag)
      continue
    }
    const total = width * n
    // Up to four bytes sit in the entry itself, more at the offset it holds.
    const start = total <= 4 ? entry + 8 : view.getUint32(entry + 8, little)
    const take = Math.min(n, MAX_VALUES)
    // The whole declared span must be in the file, not only the values read: a tag that runs past the end is
    // unreadable however many of its values are there.
    if (start + total > size) {
      page.unreadable.push(tag)
      continue
    }
    const values: number[] = []
    const rationals: Rational[] = []
    for (let k = 0; k < take; k++) {
      const p = start + k * width
      if (type === 1) values.push(view.getUint8(p))
      else if (type === 3) values.push(view.getUint16(p, little))
      else if (type === 4) values.push(view.getUint32(p, little))
      else rationals.push({ num: view.getUint32(p, little), den: view.getUint32(p + 4, little) })
    }
    if (tag === TAGS.xResolution || tag === TAGS.yResolution) {
      // TIFF gives a resolution as a RATIONAL. A whole number in a SHORT or LONG is read as that number over 1.
      const r = type === 5 ? rationals[0] : values[0] !== undefined ? { num: values[0], den: 1 } : undefined
      if (!r || r.den === 0) {
        page.unreadable.push(tag)
        continue
      }
      if (tag === TAGS.xResolution) page.xResolution = r
      else page.yResolution = r
      continue
    }
    // Every other tag the reader takes is a whole number, so a RATIONAL there is not one it reads.
    if (type === 5) {
      page.unreadable.push(tag)
      continue
    }
    const value = values[0] as number
    if (tag === TAGS.imageWidth) page.width = value
    else if (tag === TAGS.imageLength) page.length = value
    else if (tag === TAGS.bitsPerSample) page.bitsPerSample = values
    else if (tag === TAGS.compression) page.compression = value
    else if (tag === TAGS.photometric) page.photometric = value
    else if (tag === TAGS.fillOrder) page.fillOrder = value
    else if (tag === TAGS.t4Options) page.t4Options = value
    else if (tag === TAGS.t6Options) page.t6Options = value
    else if (tag === TAGS.resolutionUnit) page.resolutionUnit = value
  }
  return page
}

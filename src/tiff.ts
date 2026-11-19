/**
 * The pixels of each page of a TIFF. The chain of pages and the tags come from the reader (./tiff-read.ts), with
 * its checks on every offset. This module adds the strips: where each one is, how it is compressed, and its
 * pixels as grey, 0 black to 255 white.
 *
 * It reads black and white and 8-bit grey or RGB pages, in strips, stored uncompressed, as PackBits, LZW,
 * Deflate or fax coding (TIFF compression 2, 3 and 4, through ./ccitt.ts). Anything else is named and not read:
 * tiles, JPEG, palette images, other bit depths. A strip that points outside the file, a page over the pixel
 * limit and a strip that breaks off are refused for that page. Nothing here makes a request or keeps anything.
 */
import { InflateError, inflate as inflateRows } from '#inflate'
import { CcittError, type Decoder, decodeStrip, type Scheme } from './ccitt.js'
import { FIELD_SIZES, fieldValue, readTiff, TAGS, type TiffPage, type TiffResult } from './tiff-read.js'

export type Unreadable = 'tiles' | 'compression' | 'depth' | 'photometric' | 'strips' | 'damaged' | 'too-large' | 'no-size'

export class PageError extends Error {
  readonly kind: Unreadable
  readonly detail: string
  constructor(kind: Unreadable, detail = '') {
    super(kind)
    this.kind = kind
    this.detail = detail
  }
}

export interface GreyPage {
  width: number
  height: number
  /** 0 black to 255 white, width by height. */
  grey: Uint8Array
  /** The page's size on paper, from its resolution. Null when the file gives no usable resolution. */
  mm: { width: number; height: number } | null
  /** Its resolution across and down, per inch, when the file gives it in inches or centimetres. Null otherwise. */
  dpi: { x: number; y: number } | null
  /**
   * The height of a pixel over its width, when the file gives a resolution across and down but no unit to
   * measure it in (ResolutionUnit 1). Null otherwise.
   */
  aspect: number | null
}

const TAG = {
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripOffsets: 273,
  stripByteCounts: 279,
  planar: 284,
  predictor: 317,
  tileWidth: 322,
  extraSamples: 338,
  orientation: 274,
} as const

/** The values of the tags of an IFD this module reads, with the same bounds checks as ./tiff-read.ts. */
interface Raw {
  values: Map<number, number[]>
  /** Tags the IFD names whose values could not be read: the wrong type, out of the file or too many. */
  unreadable: Set<number>
}

function ifdOffsets(view: DataView, little: boolean, count: number): number[] {
  const out: number[] = []
  let offset = view.getUint32(4, little)
  for (let i = 0; i < count; i++) {
    out.push(offset)
    const n = view.getUint16(offset, little)
    offset = view.getUint32(offset + 2 + n * 12, little)
  }
  return out
}

function rawTags(view: DataView, little: boolean, at: number, maxValues: number): Raw {
  const values = new Map<number, number[]>()
  const unreadable = new Set<number>()
  const wanted = new Set<number>(Object.values(TAG))
  const n = view.getUint16(at, little)
  for (let i = 0; i < n; i++) {
    const e = at + 2 + i * 12
    const tag = view.getUint16(e, little)
    // The first entry of a repeated tag counts, as in ./tiff-read.ts.
    if (!wanted.has(tag) || values.has(tag)) continue
    const type = view.getUint16(e + 2, little)
    const count = view.getUint32(e + 4, little)
    // Every tag read here is a whole number, so a RATIONAL is not one of its types.
    const size = type === 5 ? undefined : FIELD_SIZES[type]
    const start = size ? (size * count <= 4 ? e + 8 : view.getUint32(e + 8, little)) : 0
    if (!size || count === 0 || count > maxValues || start + size * count > view.byteLength) {
      values.set(tag, [])
      unreadable.add(tag)
      continue
    }
    const list: number[] = []
    for (let k = 0; k < count; k++) list.push(fieldValue(view, start + k * size, type, little))
    values.set(tag, list)
  }
  return { values, unreadable }
}

/**
 * The tags that change the pixels of a page. When one of them is named but cannot be read, a default would give
 * other pixels than the file holds, so the page is refused instead.
 */
const PIXEL_TAGS: number[] = [
  TAGS.imageWidth,
  TAGS.imageLength,
  TAGS.bitsPerSample,
  TAGS.compression,
  TAGS.photometric,
  TAGS.fillOrder,
  TAGS.t4Options,
  TAG.samplesPerPixel,
  TAG.rowsPerStrip,
  TAG.stripOffsets,
  TAG.stripByteCounts,
  TAG.planar,
  TAG.predictor,
  TAG.extraSamples,
  TAG.orientation,
]

/** Millimetres per unit of a TIFF resolution: inch (2, the default) or centimetre (3). Null for no unit. */
const unitMm = (unit: number | undefined): number | null => (unit === undefined || unit === 2 ? 25.4 : unit === 3 ? 10 : null)

/** The page's size on paper from its tags, or null when a resolution is missing, zero or in no unit. */
export function paperMm(page: TiffPage): { width: number; height: number } | null {
  if (page.unreadable.includes(TAGS.resolutionUnit)) return null
  const mm = unitMm(page.resolutionUnit)
  const x = page.xResolution
  const y = page.yResolution
  if (mm === null || !x || !y || !page.width || !page.length || x.num === 0 || y.num === 0) return null
  return { width: (page.width * mm * x.den) / x.num, height: (page.length * mm * y.den) / y.num }
}

function packBits(data: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected)
  let o = 0
  let i = 0
  while (i < data.length && o < expected) {
    const n = ((data[i++] as number) << 24) >> 24
    if (n >= 0) {
      // A literal run whose bytes are not all in the strip is damage, never padding.
      if (i + Math.min(n + 1, expected - o) > data.length) throw new PageError('damaged', 'a PackBits strip ends inside a run')
      const len = Math.min(n + 1, expected - o)
      out.set(data.subarray(i, i + len), o)
      i += n + 1
      o += len
    } else if (n !== -128) {
      if (i >= data.length) throw new PageError('damaged', 'a PackBits strip ends inside a run')
      const len = Math.min(1 - n, expected - o)
      out.fill(data[i++] as number, o, o + len)
      o += len
    }
  }
  if (o < expected) throw new PageError('damaged', 'a PackBits strip ends early')
  return out
}

/** TIFF's LZW: codes of 9 to 12 bits, most significant bit first, a width step one code early, 256 clear, 257 end. */
function lzw(data: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected)
  const prefix = new Int32Array(4096)
  const suffix = new Uint8Array(4096)
  const length = new Int32Array(4096)
  for (let i = 0; i < 256; i++) {
    suffix[i] = i
    length[i] = 1
    prefix[i] = -1
  }
  let o = 0
  let bitPos = 0
  let width = 9
  let next = 258
  let prev = -1
  const read = (): number => {
    let v = 0
    for (let k = 0; k < width; k++) {
      const at = bitPos + k
      if (at >> 3 >= data.length) return 257
      v = (v << 1) | (((data[at >> 3] as number) >> (7 - (at & 7))) & 1)
    }
    bitPos += width
    return v
  }
  const write = (codeAt: number): number => {
    const len = length[codeAt] as number
    let c = codeAt
    for (let k = len - 1; k >= 0; k--) {
      if (o + k < expected) out[o + k] = suffix[c] as number
      c = prefix[c] as number
    }
    o += len
    let first = codeAt
    while ((prefix[first] as number) >= 0) first = prefix[first] as number
    return suffix[first] as number
  }
  while (o < expected) {
    const c = read()
    if (c === 257) break
    if (c === 256) {
      width = 9
      next = 258
      prev = -1
      continue
    }
    if (prev < 0) {
      if (c > 255) throw new PageError('damaged', 'an LZW strip starts with a code it has not defined')
      write(c)
      prev = c
      continue
    }
    let firstByte: number
    if (c < next) {
      firstByte = write(c)
      if (next < 4096) {
        prefix[next] = prev
        suffix[next] = firstByte
        length[next] = (length[prev] as number) + 1
        next++
      }
    } else if (c === next && next < 4096) {
      let first = prev
      while ((prefix[first] as number) >= 0) first = prefix[first] as number
      prefix[next] = prev
      suffix[next] = suffix[first] as number
      length[next] = (length[prev] as number) + 1
      next++
      write(c)
    } else {
      throw new PageError('damaged', 'an LZW strip names a code it has not defined')
    }
    prev = c
    if (next + 1 >= 1 << width && width < 12) width++
  }
  if (o < expected) throw new PageError('damaged', 'an LZW strip ends early')
  return out
}

/**
 * A Deflate strip, inflated only as far as its rows need: a strip that would inflate past them is cut there.
 * `#inflate` is zlib in Node and DecompressionStream in a browser (package.json, "imports").
 */
async function inflate(data: Uint8Array, expected: number): Promise<Uint8Array> {
  try {
    return await inflateRows(data, expected)
  } catch (err) {
    if (err instanceof InflateError) throw new PageError('damaged', err.message)
    throw err
  }
}

const CCITT: Record<number, Scheme | undefined> = { 2: 'mh-rle', 4: 't6' }
const COMPRESSIONS = new Set([1, 2, 3, 4, 5, 8, 32946, 32773])

/** The bytes of a strip that is not fax coded, decompressed as far as its rows need. */
async function plainStrip(data: Uint8Array, compression: number, lsb: boolean, expected: number): Promise<Uint8Array> {
  // FillOrder 2 orders the bits of the stored bytes, so they are turned round before they are decompressed, as
  // libtiff does. Fax coding reads its bits in either order itself.
  const stored = lsb ? reverseBits(data) : data
  if (compression === 1) return stored
  if (compression === 32773) return packBits(stored, expected)
  if (compression === 5) return lzw(stored, expected)
  return inflate(stored, expected)
}

/** Reverses the bits of each byte, for FillOrder 2 on a strip that is not fax coded. */
function reverseBits(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    let b = data[i] as number
    let r = 0
    for (let k = 0; k < 8; k++) {
      r = (r << 1) | (b & 1)
      b >>= 1
    }
    out[i] = r
  }
  return out
}

/**
 * A page turned the way TIFF's Orientation tag (274) says it is seen: 1 as stored, 2 to 4 mirrored or turned
 * half round, 5 to 8 with rows and columns swapped. The paper size turns with it. Any other value is taken as 1.
 */
export function orient(page: GreyPage, orientation: number): GreyPage {
  if (orientation < 2 || orientation > 8) return page
  const { width: w, height: h, grey } = page
  const swap = orientation >= 5
  const out = new Uint8Array(w * h)
  const ow = swap ? h : w
  const oh = swap ? w : h
  // The stored pixel shown at each place of the turned page.
  const from: Record<number, (x: number, y: number) => number> = {
    2: (x, y) => y * w + (w - 1 - x),
    3: (x, y) => (h - 1 - y) * w + (w - 1 - x),
    4: (x, y) => (h - 1 - y) * w + x,
    5: (x, y) => x * w + y,
    6: (x, y) => (h - 1 - x) * w + y,
    7: (x, y) => (h - 1 - x) * w + (w - 1 - y),
    8: (x, y) => x * w + (w - 1 - y),
  }
  const at = from[orientation] as (x: number, y: number) => number
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) out[y * ow + x] = grey[at(x, y)] as number
  const mm = page.mm && swap ? { width: page.mm.height, height: page.mm.width } : page.mm
  const dpi = page.dpi && swap ? { x: page.dpi.y, y: page.dpi.x } : page.dpi
  const aspect = page.aspect !== null && swap ? 1 / page.aspect : page.aspect
  return { width: ow, height: oh, grey: out, mm, dpi, aspect }
}

export interface PageOptions {
  /** The most pixels one page may have. */
  maxPixels: number
  decoder: Decoder
  /**
   * The strip bytes the file has left to give, shared by its pages, and the strips already counted. Each strip
   * is counted once, however many pages share it. Strips that do not overlap add up to no more than the file,
   * so a page whose strips add up to more is refused: the work of reading strips stays in proportion to the
   * size of the file.
   */
  budget?: { bytes: number; seen: Set<string> }
}

/** The longest strip read in fax coding or LZW, which count bits in 32-bit numbers: 256 MiB. */
const MAX_BIT_STRIP = 2 ** 28

/** The grey pixels of one page of a TIFF. */
export async function decodePage(bytes: Uint8Array, page: TiffPage, ifd: number, little: boolean, opts: PageOptions): Promise<GreyPage> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = page.width
  const height = page.length
  if (!width || !height || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new PageError('no-size')
  if (width * height > opts.maxPixels) throw new PageError('too-large')
  // A strip holds at least one row, so no strip list is longer than the page is high.
  const raw = rawTags(view, little, ifd, height)
  const lost = PIXEL_TAGS.find((t) => page.unreadable.includes(t) || raw.unreadable.has(t))
  if (lost !== undefined) throw new PageError(lost === TAG.stripOffsets || lost === TAG.stripByteCounts ? 'strips' : 'damaged', `tag ${lost} cannot be read`)
  const one = (tag: number, dflt: number): number => raw.values.get(tag)?.[0] ?? dflt
  if (raw.values.has(TAG.tileWidth)) throw new PageError('tiles')
  const compression = page.compression ?? 1
  if (!COMPRESSIONS.has(compression)) throw new PageError('compression', String(compression))
  const spp = one(TAG.samplesPerPixel, 1)
  const bits = page.bitsPerSample?.[0] ?? 1
  if (page.bitsPerSample?.some((b) => b !== bits)) throw new PageError('depth', page.bitsPerSample.join(', '))
  // With no PhotometricInterpretation a page is read as WhiteIsZero (0), as Pillow reads it.
  const photometric = page.photometric ?? 0
  const fax = compression >= 2 && compression <= 4
  if (fax && (bits !== 1 || spp !== 1)) throw new PageError('depth', `${bits}`)
  if (bits === 1 && spp !== 1) throw new PageError('depth', `${spp} samples of 1 bit`)
  if (bits !== 1 && bits !== 8) throw new PageError('depth', `${bits}`)
  // RGB has three samples and grey one, each with at most one extra sample, such as alpha.
  const base = photometric === 2 ? 3 : 1
  if (photometric > 2 || (photometric === 2 && bits !== 8) || spp < base || spp > base + 1) throw new PageError('photometric', String(photometric))
  // TIFF 6.0, ExtraSamples: 1 is alpha already multiplied into the colour, 2 is alpha that is not, and 0 or no
  // tag is a sample with no stated meaning, which is left out.
  const extra = spp > base ? one(TAG.extraSamples, 0) : 0
  if (spp > 1 && one(TAG.planar, 1) !== 1) throw new PageError('photometric', 'planar')
  const predictor = one(TAG.predictor, 1)
  if (predictor !== 1 && !(predictor === 2 && bits === 8)) throw new PageError('compression', `predictor ${predictor}`)

  // TIFF 6.0 gives RowsPerStrip 0xFFFFFFFF for one strip. Stored as a signed type that is -1, so a value below 1
  // or not a whole number is read as no tag: the whole page in one strip.
  const stated = one(TAG.rowsPerStrip, height)
  const rowsPerStrip = Number.isInteger(stated) && stated >= 1 ? Math.min(stated, height) : height
  const count = Math.ceil(height / rowsPerStrip)
  const offsets = raw.values.get(TAG.stripOffsets) ?? []
  const counts = raw.values.get(TAG.stripByteCounts) ?? []
  if (offsets.length < count || counts.length < count) throw new PageError('strips')
  const lsb = page.fillOrder === 2
  const rowBytes = Math.ceil((width * bits * spp) / 8)
  // Black and white pages are decoded to one byte per pixel, 1 where the stored bit is 1, then made grey.
  const pels = new Uint8Array(bits === 1 ? width * height : 0)
  const grey = new Uint8Array(width * height)
  const decoded = new Map<string, Uint8Array>()
  for (let s = 0; s < count; s++) {
    const off = offsets[s] as number
    const len = counts[s] as number
    if (off < 0 || len < 0 || off + len > bytes.length) throw new PageError('strips')
    // A strip of no bytes holds no rows, and many of them would cost a decoder each for nothing.
    if (len === 0) throw new PageError('damaged', 'a strip holds no bytes')
    const key = `${off}:${len}`
    if (opts.budget && !opts.budget.seen.has(key)) {
      opts.budget.seen.add(key)
      opts.budget.bytes -= len
      if (opts.budget.bytes < 0) throw new PageError('strips', 'the strips add up to more bytes than the file holds')
    }
    if (len > MAX_BIT_STRIP && (fax || compression === 5)) throw new PageError('too-large', 'a strip of more than 256 MiB')
    const data = bytes.subarray(off, off + len)
    const y0 = s * rowsPerStrip
    const rows = Math.min(rowsPerStrip, height - y0)
    if (fax) {
      const scheme: Scheme = CCITT[compression] ?? ((page.t4Options ?? 0) & 1 ? 't4-2d' : 't4-1d')
      try {
        decodeStrip(data, scheme, width, rows, lsb, opts.decoder, pels, y0 * width)
      } catch (err) {
        if (!(err instanceof CcittError)) throw err
        // Bit 1 of T4Options and of T6Options allows the uncompressed mode of the fax codes, which this decoder
        // does not read. A strip that fails with it allowed most likely uses it.
        const options = compression === 4 ? (page.t6Options ?? 0) : compression === 3 ? (page.t4Options ?? 0) : 0
        if (options & 2) throw new PageError('compression', 'the uncompressed mode of fax coding')
        throw new PageError('damaged', err.message)
      }
      continue
    }
    const expected = rowBytes * rows
    // A strip the page names more than once is decoded once.
    const plain = decoded.get(`${key}:${expected}`) ?? (await plainStrip(data, compression, lsb, expected))
    decoded.set(`${key}:${expected}`, plain)
    if (plain.length < expected) throw new PageError('damaged', 'a strip is shorter than its rows')
    for (let r = 0; r < rows; r++) {
      const row = plain.subarray(r * rowBytes, (r + 1) * rowBytes)
      const y = y0 + r
      if (bits === 1) {
        for (let x = 0; x < width; x++) pels[y * width + x] = ((row[x >> 3] as number) >> (7 - (x & 7))) & 1
        continue
      }
      const line = predictor === 2 ? Uint8Array.from(row) : row
      if (predictor === 2) for (let i = spp; i < line.length; i++) line[i] = ((line[i] as number) + (line[i - spp] as number)) & 255
      for (let x = 0; x < width; x++) {
        const p = x * spp
        let v = photometric === 2 ? 0.299 * (line[p] as number) + 0.587 * (line[p + 1] as number) + 0.114 * (line[p + 2] as number) : (line[p] as number)
        if (photometric === 0) v = 255 - v
        // Over white paper: alpha multiplied in already adds the white the pixel lets through, alpha that is not
        // mixes the two. An extra sample with no stated meaning is not alpha.
        const alpha = extra === 1 || extra === 2 ? (line[p + base] as number) / 255 : 1
        // With WhiteIsZero the samples count ink, and white paper adds none: premultiplied ink is the ink of the
        // pixel over white already.
        const over = extra === 1 ? (photometric === 0 ? v : v + 255 * (1 - alpha)) : v * alpha + 255 * (1 - alpha)
        grey[y * width + x] = Math.min(255, Math.round(over))
      }
    }
  }
  if (bits === 1) {
    // WhiteIsZero (0) makes a stored 1 black, BlackIsZero (1) a stored 0. Fax coding stores black runs as 1.
    const blackIs = photometric === 1 ? 0 : 1
    for (let i = 0; i < pels.length; i++) grey[i] = pels[i] === blackIs ? 0 : 255
  }
  const { xResolution: xr, yResolution: yr } = page
  const unit = page.unreadable.includes(TAGS.resolutionUnit) ? null : (page.resolutionUnit ?? 2)
  const both = xr && yr && xr.num && yr.num && xr.den && yr.den ? { x: xr.num / xr.den, y: yr.num / yr.den } : null
  // Per inch, from inches or from centimetres: the same density gives the same scan lines in either unit.
  const dpi = both && (unit === 2 || unit === 3) ? (unit === 2 ? both : { x: both.x * 2.54, y: both.y * 2.54 }) : null
  // TIFF 6.0, ResolutionUnit: "1 = No absolute unit of measurement. Used for images that may have a non-square
  // aspect ratio, but no meaningful absolute dimensions."
  const aspect = unit === 1 && both ? both.x / both.y : null
  return orient({ width, height, grey, mm: paperMm(page), dpi, aspect }, one(TAG.orientation, 1))
}

export interface TiffFile {
  result: TiffResult
  ifds: number[]
  little: boolean
}

/** The page chain of a TIFF, through ./tiff-read.ts, and where each page's IFD is. */
export function openTiff(bytes: Uint8Array, maxPages: number): TiffFile {
  const result = readTiff(bytes, maxPages)
  const little = result.byteOrder === 'II'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { result, ifds: ifdOffsets(view, little, result.pages.length), little }
}

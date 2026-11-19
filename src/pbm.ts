/**
 * The PBM reader, for the Netpbm bi-level format: raw PBM (magic "P4") and plain PBM (magic "P1"), one or more
 * images in a file. In both a 1 is black and a 0 is white, and the pixels are square. A PBM gives no
 * resolution, so a page is taken as the full width of the scan line unless a resolution is passed with it.
 *
 * Every image's size is checked against the bytes the file holds before any memory is taken for it, so a header
 * that claims a huge image asks for nothing. Nothing here makes a request or keeps anything.
 */

export type PbmError = 'not-pbm' | 'damaged' | 'too-large'

export class PbmReadError extends Error {
  readonly kind: PbmError
  constructor(kind: PbmError, message: string = kind) {
    super(message)
    this.kind = kind
  }
}

export interface PbmImage {
  width: number
  height: number
  /** width × height bytes, row by row from the top, 1 for black and 0 for white. */
  pixels: Uint8Array
}

export interface PbmResult {
  images: PbmImage[]
  /** True when the file holds more images than `maxPages`. */
  more: boolean
  /** Why the file stopped being read after `images`: an image that is cut off, too large or not PBM. */
  stopped: { image: number; kind: PbmError; detail: string } | null
}

const isSpace = (b: number | undefined): boolean => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0b || b === 0x0c || b === 0x0d

class Cursor {
  readonly bytes: Uint8Array
  pos: number
  constructor(bytes: Uint8Array, pos: number) {
    this.bytes = bytes
    this.pos = pos
  }
  /** Skips white space and comments, from a "#" to the end of its line. */
  skip(): void {
    for (;;) {
      const b = this.bytes[this.pos]
      if (isSpace(b)) this.pos++
      else if (b === 0x23) {
        while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0x0a && this.bytes[this.pos] !== 0x0d) this.pos++
      } else return
    }
  }
  /** A whole number in ASCII decimal, after white space and comments. */
  number(what: string): number {
    this.skip()
    const start = this.pos
    while (this.pos < this.bytes.length && (this.bytes[this.pos] as number) >= 0x30 && (this.bytes[this.pos] as number) <= 0x39) this.pos++
    if (this.pos === start) throw new PbmReadError('damaged', `the ${what} is not a number`)
    let first = start
    while (first < this.pos - 1 && this.bytes[first] === 0x30) first++
    // Leading zeros say nothing. More than nine digits is a billion pixels or more, past any limit.
    if (this.pos - first > 9) throw new PbmReadError('too-large', `the ${what} has ${this.pos - first} digits`)
    const n = Number(String.fromCharCode(...this.bytes.subarray(first, this.pos)))
    if (n === 0) throw new PbmReadError('damaged', `the ${what} is 0`)
    return n
  }
}

const magic = (bytes: Uint8Array, at: number): string => (at + 1 < bytes.length ? String.fromCharCode(bytes[at] as number, bytes[at + 1] as number) : '')

/** The images of a PBM file, up to `maxPages`, each of at most `maxPixels` pixels. */
export function readPbm(bytes: Uint8Array, maxPages: number, maxPixels: number): PbmResult {
  const first = magic(bytes, 0)
  if (first !== 'P1' && first !== 'P4') throw new PbmReadError('not-pbm', 'the file does not start with P1 or P4')
  const images: PbmImage[] = []
  let at = 0
  for (;;) {
    const kind = magic(bytes, at)
    if (kind !== 'P1' && kind !== 'P4')
      return { images, more: false, stopped: { image: images.length + 1, kind: 'not-pbm', detail: 'the data after the last image is not another PBM image' } }
    if (images.length === maxPages) return { images, more: true, stopped: null }
    try {
      const c = new Cursor(bytes, at + 2)
      // The magic number is followed by white space.
      if (!isSpace(bytes[c.pos]) && bytes[c.pos] !== 0x23) throw new PbmReadError('damaged', 'the magic number runs into the header')
      const width = c.number('width')
      const height = c.number('height')
      if (width * height > maxPixels) throw new PbmReadError('too-large', `${width} by ${height} pixels`)
      // A comment may come between the height and the white space that ends the header. It runs to, and not
      // over, the end of its line, and that line end is the white space.
      if (bytes[c.pos] === 0x23) while (c.pos < bytes.length && bytes[c.pos] !== 0x0a && bytes[c.pos] !== 0x0d) c.pos++
      // A single white space character ends the header.
      if (!isSpace(bytes[c.pos])) throw new PbmReadError('damaged', 'the header does not end in white space')
      c.pos++
      const pixels = kind === 'P4' ? raw(bytes, c, width, height) : plain(bytes, c, width, height)
      images.push({ width, height, pixels })
      // Images follow each other in one file. White space at the end is no further image, and so is anything a
      // plain image is followed by that is not another image.
      at = c.pos
      while (isSpace(bytes[at])) at++
      if (at >= bytes.length) return { images, more: false, stopped: null }
      if (kind === 'P1' && magic(bytes, at) !== 'P1' && magic(bytes, at) !== 'P4') return { images, more: false, stopped: null }
    } catch (err) {
      if (!(err instanceof PbmReadError)) throw err
      return { images, more: false, stopped: { image: images.length + 1, kind: err.kind, detail: err.message } }
    }
  }
}

/** Rows of `width` bits packed 8 to a byte, most significant bit first, each row starting on a byte. */
function raw(bytes: Uint8Array, c: Cursor, width: number, height: number): Uint8Array {
  const rowBytes = Math.ceil(width / 8)
  if (rowBytes * height > bytes.length - c.pos) throw new PbmReadError('damaged', 'the raster is shorter than the image')
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = c.pos + y * rowBytes
    for (let x = 0; x < width; x++) out[y * width + x] = ((bytes[row + (x >> 3)] as number) >> (7 - (x & 7))) & 1
  }
  c.pos += rowBytes * height
  return out
}

/** One ASCII "0" or "1" a pixel, with white space and comments anywhere between them. */
function plain(bytes: Uint8Array, c: Cursor, width: number, height: number): Uint8Array {
  const total = width * height
  // Each pixel takes at least one byte of the file.
  if (total > bytes.length - c.pos) throw new PbmReadError('damaged', 'the raster is shorter than the image')
  const out = new Uint8Array(total)
  for (let i = 0; i < total; i++) {
    c.skip()
    const b = bytes[c.pos]
    if (b === 0x31) out[i] = 1
    else if (b !== 0x30) throw new PbmReadError('damaged', b === undefined ? 'the raster is shorter than the image' : 'a pixel is not 0 or 1')
    c.pos++
  }
  return out
}

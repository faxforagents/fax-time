/**
 * One page, from its grey pixels to the data bits of every scan line at standard and at fine resolution.
 * Nothing here reads a file, makes a request or keeps anything.
 */
import { type CodeLengths, pageLineBits } from './mh.js'
import { type Line, place, toPels } from './raster.js'
import { PageError } from './tiff.js'

export interface PageSettings {
  line: Line
  linesPerMm: { standard: number; fine: number }
  tolerance: number
  /** The most pixels one page may have, and the most pels its scan lines may hold. */
  maxPixels: number
  /**
   * The resolutions RFC 3949 treats as equivalent, per inch: across the line, and down it for standard and for
   * fine. A page as wide as the line at one of them is coded line for line at its own resolution.
   */
  equivalent: { dpi: number[]; standard: number[]; fine: number[] }
}

export interface CodedPage {
  /** 1 for the first page of a file. */
  number: number
  /** The data bits of each scan line at standard resolution, without its EOL. */
  standard: Uint32Array
  /** The same at fine resolution. */
  fine: Uint32Array
  /**
   * True when the page gave no size on paper and was taken as the width of the line: with square pixels, or with
   * the shape of its pixels when it gives a resolution in no unit.
   */
  assumed: boolean
}

/**
 * The bits of each line of one page at both resolutions. `mm` is the page's size on paper, or null when it gives
 * none. `own` is true for a page with pixels of its own, such as a TIFF or a bitmap, which are used as they are
 * when they already fit the line. `aspect` is the height of a pixel over its width when the page gives that and
 * no size, and 1 for square pixels.
 */
export function codePage(
  number: number,
  grey: Uint8Array,
  width: number,
  height: number,
  mm: { width: number; height: number } | null,
  own: boolean,
  s: PageSettings,
  lengths: CodeLengths,
  dpi: { x: number; y: number } | null = null,
  aspect: number | null = null,
): CodedPage {
  let size = mm ?? { width: s.line.mm, height: (s.line.mm * height * (aspect ?? 1)) / width }
  // A fax page: as many pels as the line, across at 200 or 204 per inch, down at the lines of standard or fine.
  // Its width is the whole line and each row is one scan line of that resolution, as RFC 3949 treats them.
  const rows =
    own && dpi && width === s.line.pels && s.equivalent.dpi.includes(dpi.x)
      ? s.equivalent.standard.includes(dpi.y)
        ? 'standard'
        : s.equivalent.fine.includes(dpi.y)
          ? 'fine'
          : null
      : null
  if (rows) size = { width: s.line.mm, height: height / s.linesPerMm[rows] }
  // A size that is not a finite number of millimetres, such as one from a resolution of 1e-300 per inch, would
  // place no scan lines at all.
  if (!(Number.isFinite(size.width) && Number.isFinite(size.height) && size.width > 0 && size.height > 0)) throw new PageError('no-size')
  const at = (linesPerMm: number): Uint32Array => {
    const p = place(size.width, size.height, linesPerMm, s.line, s.tolerance, own ? { width, height } : undefined)
    // The scan lines are held to the same limit as a page's pixels: a tiny file that claims a page metres long
    // would otherwise ask for gigabytes.
    if (p.lines * s.line.pels > s.maxPixels) throw new PageError('too-large')
    return pageLineBits(toPels(grey, width, height, p, s.line), s.line.pels, p.lines, lengths)
  }
  // Fine first: it has the more lines, so a page over the limit is refused before any work.
  const fine = at(s.linesPerMm.fine)
  return { number, standard: at(s.linesPerMm.standard), fine, assumed: mm === null }
}

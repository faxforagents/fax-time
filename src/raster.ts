/**
 * From the pixels of a page to the black and white pels of fax scan lines. Every figure arrives as an argument
 * from ./standards.ts, where each one is read from a quote of T.4.
 *
 * A page is laid on the scan line at its own size and centred. A page wider than the line is scaled down to fit
 * it. Each pel is the average of the source pixels it covers, and a pel darker than mid-grey is black. When the
 * page's own pixels are already within T.4's tolerance of the pels and lines worked out, they are used as they
 * are, so a fax TIFF at 1728 pels and 3.85 or 7.7 lines per millimetre is coded pixel for pixel.
 */

export interface Line {
  /** Pels along the scan line: 1728. */
  pels: number
  /** Its length in millimetres: 215. */
  mm: number
}

export interface Placement {
  /** Pels the page covers, at most line.pels. */
  cols: number
  /** Pels of white to the left of the page. */
  left: number
  lines: number
}

/**
 * Where a page of `widthMm` by `heightMm` sits on the line at `linesPerMm`. `own` is the page's own pixel width
 * and height when it has pixels of its own (a TIFF): within `tolerance` of the worked-out size, they are kept.
 */
export function place(
  widthMm: number,
  heightMm: number,
  linesPerMm: number,
  line: Line,
  tolerance: number,
  own?: { width: number; height: number },
): Placement {
  if (!(widthMm > 0) || !(heightMm > 0)) throw new RangeError('a page with no size')
  const k = Math.min(1, line.mm / widthMm)
  let cols = Math.min(line.pels, Math.max(1, Math.round((widthMm * k * line.pels) / line.mm)))
  let lines = Math.max(1, Math.round(heightMm * k * linesPerMm))
  if (own) {
    if (own.width <= line.pels && Math.abs(own.width - cols) <= tolerance * cols) cols = own.width
    if (Math.abs(own.height - lines) <= tolerance * lines) lines = own.height
  }
  return { cols, left: Math.floor((line.pels - cols) / 2), lines }
}

/**
 * The pels of a page: `grey` holds `width` by `height` source pixels, one byte each, 0 black to 255 white. The
 * result holds `p.lines` rows of `line.pels` bytes, 1 for black. Each pel averages the source pixels it covers,
 * by area. Memory is the result and two rows of `p.cols` sums: nothing the size of the source is allocated, and
 * each source row is drawn down to the pels once, however many scan lines it falls in.
 */
export function toPels(grey: Uint8Array | Uint8ClampedArray, width: number, height: number, p: Placement, line: Line): Uint8Array {
  if (grey.length < width * height) throw new RangeError('fewer pixels than the page size')
  const out = new Uint8Array(p.lines * line.pels)
  const sx = width / p.cols
  const sy = height / p.lines
  // One source row as the average over each pel's columns, kept for the next scan line that needs it.
  const cache = new Map<number, Float64Array>()
  const across = (j: number): Float64Array => {
    const hit = cache.get(j)
    if (hit) return hit
    const row = new Float64Array(p.cols)
    const base = j * width
    for (let x = 0; x < p.cols; x++) {
      const a = x * sx
      const b = (x + 1) * sx
      let v = 0
      for (let i = Math.floor(a); i < Math.min(width, Math.ceil(b)); i++) v += (grey[base + i] as number) * (Math.min(b, i + 1) - Math.max(a, i))
      row[x] = v / sx
    }
    if (cache.size >= 2) cache.delete(cache.keys().next().value as number)
    cache.set(j, row)
    return row
  }
  const acc = new Float64Array(p.cols)
  for (let y = 0; y < p.lines; y++) {
    acc.fill(0)
    const a = y * sy
    const b = (y + 1) * sy
    for (let j = Math.floor(a); j < Math.min(height, Math.ceil(b)); j++) {
      const wy = (Math.min(b, j + 1) - Math.max(a, j)) / sy
      if (!(wy > 0)) continue
      const row = across(j)
      for (let x = 0; x < p.cols; x++) acc[x] = (acc[x] as number) + (row[x] as number) * wy
    }
    const at = y * line.pels + p.left
    // Darker than mid-grey is black. A pel at mid-grey exactly is white: the margin keeps rounding in the sums
    // from deciding a tie.
    for (let x = 0; x < p.cols; x++) if ((acc[x] as number) < 127.5 - 1e-6) out[at + x] = 1
  }
  return out
}

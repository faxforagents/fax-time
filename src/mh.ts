/**
 * T.4 one-dimensional coding (Modified Huffman) of a scan line, and the bits and seconds of a page on the line.
 * Every code word arrives as an argument, from Tables 2 and 3a of T.4 as ./standards.json holds them. Nothing in
 * this module reads a file, makes a request or keeps anything.
 *
 * T.4 (07/03), the clauses this follows:
 * - 4.1.1: a line is a series of code words for runs of white and black that alternate, and it begins with a
 *   white run, of zero when the line starts black. A run of 0 to 63 pels is one terminating code word. A longer
 *   one is the make-up code word for the largest multiple of 64 that fits, then the terminating code word for
 *   the rest.
 * - 4.1.2: an EOL follows each line of data, and one comes before the first line of a page.
 * - 4.1.3: fill (zeros) goes between a line's data and its EOL, so data, fill and EOL take at least the minimum
 *   transmission time of the total coded scan line.
 * - 4.1.4 and Figure 2: six consecutive EOLs end the page (RTC), and the last line's own EOL is the first of them.
 */

export interface ColourCodes {
  /** Run lengths 0 to 63, in order. */
  terminating: string[]
  /** Run lengths 64, 128, ... in order. */
  makeUp: string[]
}

export interface CodeTables {
  white: ColourCodes
  black: ColourCodes
  /** The EOL of T.4 4.1.2. */
  eol: string
}

/** The lengths in bits of the same code words, which is all the counting needs. */
export interface CodeLengths {
  white: { terminating: number[]; makeUp: number[] }
  black: { terminating: number[]; makeUp: number[] }
  eol: number
}

export const lengthsOf = (t: CodeTables): CodeLengths => ({
  white: { terminating: t.white.terminating.map((c) => c.length), makeUp: t.white.makeUp.map((c) => c.length) },
  black: { terminating: t.black.terminating.map((c) => c.length), makeUp: t.black.makeUp.map((c) => c.length) },
  eol: t.eol.length,
})

/** 0 for white, 1 for black. */
export type Colour = 0 | 1

/**
 * The code words of one run, as a string of 0 and 1. A run longer than the last make-up code covers is refused:
 * the coder codes lines of 1728 pels, the longest run Table 3a has a code for.
 */
export function runCode(run: number, colour: Colour, t: CodeTables): string {
  const codes = colour === 0 ? t.white : t.black
  if (!Number.isInteger(run) || run < 0) throw new RangeError(`a run of ${run} pels`)
  if (run < codes.terminating.length) return codes.terminating[run] as string
  // Table 3a's make-up codes are multiples of 64, one more than the last terminating run length.
  const step = codes.terminating.length
  const index = Math.floor(run / step) - 1
  const makeUp = codes.makeUp[index]
  if (makeUp === undefined) throw new RangeError(`a run of ${run} pels is longer than Table 3a codes`)
  return makeUp + (codes.terminating[run - (index + 1) * step] as string)
}

/** The bits of one run: the same choice of code words as runCode, counted. */
export function runBits(run: number, colour: Colour, l: CodeLengths): number {
  const codes = colour === 0 ? l.white : l.black
  if (run < codes.terminating.length) return codes.terminating[run] as number
  const step = codes.terminating.length
  const index = Math.floor(run / step) - 1
  const makeUp = codes.makeUp[index]
  if (makeUp === undefined) throw new RangeError(`a run of ${run} pels is longer than Table 3a codes`)
  return makeUp + (codes.terminating[run - (index + 1) * step] as number)
}

/**
 * The run lengths of a line, white first: a line that starts black begins with a white run of 0. `row` holds one
 * byte per pel, 1 for black, from `start` for `width` pels.
 */
export function runs(row: ArrayLike<number>, width: number, start = 0): number[] {
  const out: number[] = []
  let colour = 0
  let length = 0
  for (let x = 0; x < width; x++) {
    const pel = row[start + x] ? 1 : 0
    if (pel === colour) length++
    else {
      out.push(length)
      colour = pel
      length = 1
    }
  }
  out.push(length)
  return out
}

/** The data of one coded line, without its EOL: the code words of its runs, white first. */
export function encodeLine(row: ArrayLike<number>, width: number, t: CodeTables, start = 0): string {
  return runs(row, width, start)
    .map((run, i) => runCode(run, (i % 2) as Colour, t))
    .join('')
}

/** The bits of encodeLine, counted without building the string. */
export function lineBits(row: ArrayLike<number>, width: number, l: CodeLengths, start = 0): number {
  let bits = 0
  let colour: Colour = 0
  let length = 0
  for (let x = 0; x < width; x++) {
    const pel = row[start + x] ? 1 : 0
    if (pel === colour) length++
    else {
      bits += runBits(length, colour, l)
      colour = pel as Colour
      length = 1
    }
  }
  return bits + runBits(length, colour, l)
}

/** The bits of every line of a page: `pels` holds `lines` rows of `width` bytes, 1 for black. */
export function pageLineBits(pels: Uint8Array, width: number, lines: number, l: CodeLengths): Uint32Array {
  const out = new Uint32Array(lines)
  for (let y = 0; y < lines; y++) out[y] = lineBits(pels, width, l, y * width)
  return out
}

/**
 * The fewest bits a total coded scan line takes at `bitsPerSecond` and a minimum time of `ms` milliseconds: the
 * bits the line carries in that time, rounded up, since fill is a whole number of bits.
 */
export const minLineBits = (bitsPerSecond: number, ms: number): number => Math.ceil((bitsPerSecond * ms) / 1000)

export interface PageBits {
  /** Scan lines on the page. */
  lines: number
  /** Code words and EOLs: the EOL before the first line, each line's data and EOL, and the rest of the RTC. */
  coded: number
  /** Zeros added so each line takes the minimum time. */
  fill: number
  /** coded + fill: the bits of the page on the line. */
  total: number
}

/**
 * The bits of one page, from the data bits of each line (without EOL). `rtcEols` is the six EOLs of the RTC. The
 * last line's EOL is the first of them, so the page has one EOL before its first line, one after each line and
 * rtcEols - 1 after the last.
 */
export function pageBits(lineData: ArrayLike<number>, eol: number, rtcEols: number, minBits: number): PageBits {
  let coded = eol + (rtcEols - 1) * eol
  let fill = 0
  for (let i = 0; i < lineData.length; i++) {
    const line = (lineData[i] as number) + eol
    coded += line
    if (line < minBits) fill += minBits - line
  }
  return { lines: lineData.length, coded, fill, total: coded + fill }
}

/** Seconds on the line for `bits` at `bitsPerSecond`. */
export const seconds = (bits: number, bitsPerSecond: number): number => bits / bitsPerSecond

/** A rate the way the ITU texts print it: 2400, 14 400. */
export const ituRate = (n: number): string => (n >= 10000 ? `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, '0')}` : String(n))

/** The fewest or the most data bits any line of `width` pels can take, over every way to split it into runs, white first. */
function lineBitsBound(width: number, l: CodeLengths, most: boolean): number {
  const start = most ? -Infinity : Infinity
  const better = (a: number, b: number): boolean => (most ? a > b : a < b)
  // white[pos] and black[pos]: the bound for coding pels 0 to pos with the last run of that colour.
  const white = new Float64Array(width + 1).fill(start)
  const black = new Float64Array(width + 1).fill(start)
  // The first run is white, of 0 pels when the line starts black.
  for (let run = 0; run <= width; run++) white[run] = runBits(run, 0, l)
  for (let pos = 0; pos < width; pos++) {
    const w = white[pos] as number
    const b = black[pos] as number
    for (let run = 1; pos + run <= width; run++) {
      if (Number.isFinite(w) && better(w + runBits(run, 1, l), black[pos + run] as number)) black[pos + run] = w + runBits(run, 1, l)
      if (pos > 0 && Number.isFinite(b) && better(b + runBits(run, 0, l), white[pos + run] as number)) white[pos + run] = b + runBits(run, 0, l)
    }
  }
  return most ? Math.max(white[width] as number, black[width] as number) : Math.min(white[width] as number, black[width] as number)
}

/** The fewest data bits any line of `width` pels can take. */
export const fewestLineBits = (width: number, l: CodeLengths): number => lineBitsBound(width, l, false)
/** The most data bits any line of `width` pels can take. */
export const mostLineBits = (width: number, l: CodeLengths): number => lineBitsBound(width, l, true)

/**
 * The decoder for fax-coded TIFF strips: T.4 one-dimensional (Modified Huffman), T.4 two-dimensional (Modified
 * READ) and T.6 (Modified Modified READ, Group 4), as TIFF stores them (compression 2, 3 and 4). It only reads a
 * file's pixels. The coder then codes them again with its own encoder, at the resolution asked for.
 *
 * The code words are the tables of ./standards.json: Tables 2, 3a and 3b of T.4 for run lengths and Table 4 for
 * the two-dimensional modes. A strip that breaks a rule throws CcittError, and nothing reads past the strip.
 */

export class CcittError extends Error {}

export interface DecodeTables {
  white: { terminating: string[]; makeUp: string[] }
  black: { terminating: string[]; makeUp: string[] }
  /** Table 3b: make-up codes for both colours from `from` in steps of `step`. */
  extended: { from: number; step: number; codes: string[] }
  eol: string
  modes: { pass: string; horizontal: string; vertical: Record<string, string> }
}

/** A lookup on (1 << length) | bits, so a code is found one bit at a time with no string work. */
type Lookup = Int32Array
const MAX_BITS = 13
// Not a value any table holds: run lengths are 0 or more, vertical offsets -3 to 3.
const NONE = -0x7fffffff

function lookup(entries: [string, number][]): Lookup {
  const table = new Int32Array(1 << (MAX_BITS + 1)).fill(NONE)
  for (const [code, value] of entries) {
    if (code.length > MAX_BITS) throw new CcittError(`a code word of ${code.length} bits`)
    table[(1 << code.length) | parseInt(code, 2)] = value
  }
  return table
}

export interface Decoder {
  white: Lookup
  black: Lookup
  modes: Lookup
  eolBits: number
  /** Run lengths below this end a run: the number of terminating codes. */
  terminating: number
}

/** Mode values in the mode lookup: vertical offsets are -3 to 3, the two others are outside that range. */
const PASS = 100
const HORIZONTAL = 101

export function decoder(t: DecodeTables): Decoder {
  const runs = (c: { terminating: string[]; makeUp: string[] }): [string, number][] => [
    ...c.terminating.map((code, i): [string, number] => [code, i]),
    ...c.makeUp.map((code, i): [string, number] => [code, (i + 1) * c.terminating.length]),
    ...t.extended.codes.map((code, i): [string, number] => [code, t.extended.from + i * t.extended.step]),
  ]
  const modes: [string, number][] = [
    [t.modes.pass, PASS],
    [t.modes.horizontal, HORIZONTAL],
    ...Object.entries(t.modes.vertical).map(([k, code]): [string, number] => [code, Number(k)]),
  ]
  return { white: lookup(runs(t.white)), black: lookup(runs(t.black)), modes: lookup(modes), eolBits: t.eol.length, terminating: t.white.terminating.length }
}

/** Bits of a strip, most significant first, or least significant first when the TIFF's FillOrder is 2. */
export class Bits {
  readonly data: Uint8Array
  readonly lsb: boolean
  pos = 0
  constructor(data: Uint8Array, lsb: boolean) {
    this.data = data
    this.lsb = lsb
  }
  get left(): number {
    return this.data.length * 8 - this.pos
  }
  peek(at = this.pos): number {
    if (at >= this.data.length * 8) return -1
    const byte = this.data[at >> 3] as number
    return this.lsb ? (byte >> (at & 7)) & 1 : (byte >> (7 - (at & 7))) & 1
  }
  bit(): number {
    const b = this.peek()
    if (b < 0) throw new CcittError('the strip ends inside a line')
    this.pos++
    return b
  }
  align(): void {
    this.pos = (this.pos + 7) & ~7
  }
}

function code(bits: Bits, table: Lookup): number {
  let key = 1
  for (let n = 0; n < MAX_BITS; n++) {
    key = (key << 1) | bits.bit()
    const v = table[key] as number
    if (v !== NONE) return v
  }
  throw new CcittError('no code word matches')
}

/** One run: make-up codes, then the terminating code that ends it. */
function run(bits: Bits, colour: number, d: Decoder): number {
  const table = colour ? d.black : d.white
  let total = 0
  for (;;) {
    const v = code(bits, table)
    total += v
    if (v < d.terminating) return total
  }
}

/**
 * An EOL at the reading position, after any number of zeros of fill: eleven or more zeros, then a 1. Returns
 * true and moves past it when there is one; otherwise leaves the position as it was.
 */
export function eol(bits: Bits, d: Decoder): boolean {
  let at = bits.pos
  let zeros = 0
  while (bits.peek(at) === 0) {
    zeros++
    at++
  }
  if (zeros >= d.eolBits - 1 && bits.peek(at) === 1) {
    bits.pos = at + 1
    return true
  }
  return false
}

/** One line coded one-dimensionally, as the positions where the colour changes, white first. */
export function line1d(bits: Bits, width: number, d: Decoder): number[] {
  const changes: number[] = []
  let a0 = 0
  let colour = 0
  while (a0 < width) {
    a0 += run(bits, colour, d)
    if (a0 > width) throw new CcittError('a line runs past the page width')
    changes.push(a0)
    // Only the first run may be empty: a line of runs of 0 would grow without end.
    if (changes.length > width + 1) throw new CcittError('a line has more runs than pels')
    colour ^= 1
  }
  // A line that ends on a colour change at the edge has one change at `width`, which marks nothing.
  while (changes.length && changes[changes.length - 1] === width) changes.pop()
  return changes
}

/** One line coded two-dimensionally against the changes of the line above, as T.4 4.2.1.3 describes. */
export function line2d(bits: Bits, width: number, ref: number[], d: Decoder): number[] {
  const changes: number[] = []
  let a0 = -1
  let colour = 0
  let i = 0
  while (a0 < width) {
    // b1: the first change on the line above to the right of a0 and to the colour opposite a0's, b2 the next one.
    // a0 only moves right, but a vertical code can set it up to three pels left of the last b1: step back first.
    while (i > 0 && (ref[i - 1] as number) > a0) i--
    while (i < ref.length && ((ref[i] as number) <= a0 || (i & 1) !== colour)) i++
    const b1 = i < ref.length ? (ref[i] as number) : width
    const b2 = i + 1 < ref.length ? (ref[i + 1] as number) : width
    const mode = code(bits, d.modes)
    if (mode === PASS) {
      a0 = b2
    } else if (mode === HORIZONTAL) {
      const start = Math.max(a0, 0)
      const a1 = start + run(bits, colour, d)
      const a2 = a1 + run(bits, colour ^ 1, d)
      if (a2 > width) throw new CcittError('a line runs past the page width')
      // Every mode moves a0 to the right: two empty runs would code the same place again and again.
      if (a2 <= a0) throw new CcittError('a horizontal code does not move along the line')
      changes.push(a1, a2)
      a0 = a2
    } else {
      const a1 = b1 + mode
      // a1 is to the right of a0. At the start of a line a0 sits just before the first pel, so a1 may be 0.
      if (a1 <= a0 || a1 > width) throw new CcittError('a vertical code points outside the line')
      changes.push(a1)
      a0 = a1
      colour ^= 1
    }
  }
  while (changes.length && changes[changes.length - 1] === width) changes.pop()
  return changes
}

/** Writes a line's pixels: 1 where the line is black, from its colour changes. */
export function fill(changes: number[], width: number, out: Uint8Array, at: number): void {
  let colour = 0
  let x = 0
  for (const c of [...changes, width]) {
    const end = Math.min(c, width)
    if (colour) out.fill(1, at + x, at + end)
    x = Math.max(x, end)
    colour ^= 1
  }
}

export type Scheme = 'mh-rle' | 't4-1d' | 't4-2d' | 't6'

/**
 * Decodes `rows` lines of one strip into `out` from `at`, one byte per pixel, 1 where the coded line is black.
 * 'mh-rle' is TIFF compression 2: Modified Huffman lines with no EOL, each starting on a byte.
 */
export function decodeStrip(data: Uint8Array, scheme: Scheme, width: number, rows: number, lsb: boolean, d: Decoder, out: Uint8Array, at: number): void {
  const bits = new Bits(data, lsb)
  let ref: number[] = []
  for (let y = 0; y < rows; y++) {
    let changes: number[]
    if (scheme === 'mh-rle') {
      if (y > 0) bits.align()
      changes = line1d(bits, width, d)
    } else if (scheme === 't6') {
      changes = line2d(bits, width, ref, d)
    } else {
      const hadEol = eol(bits, d)
      let twoD = false
      if (scheme === 't4-2d') {
        if (!hadEol) throw new CcittError('a two-dimensional line has no EOL and tag bit')
        twoD = bits.bit() === 0
      }
      changes = twoD ? line2d(bits, width, ref, d) : line1d(bits, width, d)
    }
    fill(changes, width, out, at + y * width)
    ref = changes
  }
}

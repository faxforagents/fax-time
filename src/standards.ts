/**
 * The figures of the coder, each read out of a sentence or a table cell of the standards in ./standards.json:
 * ITU-T T.4 (07/03), ITU-T T.30 (09/05) and RFC 3949. No figure is typed here. The 1728 pels of the 215 mm scan
 * line, the 3.85 and 7.7 lines per millimetre and the 1% they may be off, the six EOLs of the RTC, the minimum
 * scan line times and the modem rates all come from a quote.
 *
 * Loading this module checks the data. It throws when a figure is not in the words it is read from, when a code
 * table is not the size T.4 gives it or not a prefix code, or when a text is not the edition the data names.
 */
import { type CodeTables, ituRate } from './mh.js'
import data from './standards.json' with { type: 'json' }

const fail = (message: string): never => {
  throw new Error(`faxforagents-fax-time standards: ${message}`)
}

export interface Text {
  id: string
  /** "ITU-T T.4", "ITU-T T.30" or "RFC 3949". */
  label: string
  edition: string
  title: string
  /** The text the quotes were read from. */
  url: string
  /** The day the quotes were last read in that text. */
  read: string
}

/** The three texts the quotes come from. An ITU text is the PDF of the edition the data names. */
export const TEXTS: Record<string, Text> = Object.fromEntries(
  Object.entries(data.texts).map(([id, t]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.read)) fail(`${id} has no reading date`)
    if (t.label.startsWith('ITU-T ')) {
      const edition = /^(T\.\d+) \((\d{2})\/(\d{2})\)$/.exec(t.edition) ?? fail(`${id} names no ITU edition`)
      const yyyy = Number(edition[3]) < 50 ? `20${edition[3]}` : `19${edition[3]}`
      const pdf = `https://www.itu.int/rec/dologin_pub.asp?lang=e&id=T-REC-${edition[1]}-${yyyy}${edition[2]}-I!!PDF-E&type=items`
      if (t.url !== pdf || t.label !== `ITU-T ${edition[1]}`) fail(`${id} is not the PDF of ${t.edition}`)
    }
    return [id, { id, label: t.label, edition: t.edition, title: t.title, url: t.url, read: t.read }]
  }),
)

/** The modems whose titles name a rate: V.27 ter, V.29, V.17 and V.34. */
export const MODEMS: Record<string, { id: string; label: string; edition: string; title: string; url: string }> = Object.fromEntries(
  Object.entries(data.modems).map(([id, m]) => [id, { id, label: m.label, edition: m.edition, title: m.title, url: m.url }]),
)

export interface Quote {
  id: string
  /** "ITU-T T.4", "ITU-T T.30" or "RFC 3949". */
  source: string
  /** The clause, item, note or table cell, such as "4.1.4" or "Table 2, bits 11 to 14, DCS". */
  clause: string
  /** The words, as the text prints them. */
  says: string
  /** The text they are in. */
  href: string
}

export const QUOTES: Record<string, Quote> = Object.fromEntries(
  Object.entries(data.quotes).map(([id, q]) => {
    const text = TEXTS[q.text] ?? fail(`${id} cites the text ${q.text}, which is not listed`)
    if (!q.says.trim() || q.says !== q.says.trim()) fail(`${id} has an empty or padded quote`)
    if (!/^(\d+(\.\d+)*( [a-z]\))?|Table 2, (note \d+|bits \d+ to \d+, DCS)|F\.3)$/.test(q.clause)) fail(`${id} names no clause or table`)
    return [id, { id, source: text.label, clause: q.clause, says: q.says, href: text.url }]
  }),
)

const says = (id: string): string => (QUOTES[id] ?? fail(`no quote ${id}`)).says
/** The one match of `pattern` in a quote, or the module does not load. */
const read = (id: string, pattern: RegExp): RegExpExecArray => pattern.exec(says(id)) ?? fail(`${id} no longer says what this module reads from it`)
const WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }

export interface Line {
  /** Pels along the scan line. */
  pels: number
  /** Its length in millimetres. */
  mm: number
}

/** T.4 4.1.1: "A total of 1728 picture elements represent one horizontal scan line of 215 mm length." */
const lineMatch = read('t4-line', /^A total of (\d+) picture elements represent one horizontal scan line of (\d+) mm length\.$/)
export const LINE: Line = { pels: Number(lineMatch[1]), mm: Number(lineMatch[2]) }
// The same figures in clause 2.1 c).
const widthMatch = read('t4-width-1728', /^c\) (\d+) black and white picture elements along the standard scan line length of (\d+) mm ±1%;$/)
if (Number(widthMatch[1]) !== LINE.pels || Number(widthMatch[2]) !== LINE.mm) fail('clauses 2.1 c) and 4.1.1 give different scan lines')

export type ResolutionId = 'standard' | 'fine'

export interface Resolution {
  id: ResolutionId
  label: string
  linesPerMm: number
  /** The id of the quote the figure is read from. */
  quote: string
}
const standardMatch = read('t4-standard', /^a\) a standard resolution of ([\d.]+) lines\/mm ± (\d+)% in vertical resolution;$/)
const fineMatch = read('t4-higher', /^b\) optional higher resolution of ([\d.]+) lines\/mm ± 1% and [\d.]+ lines\/mm ± 1% in vertical direction;$/)
/** T.4 2.1 a) and b): standard and fine resolution, in scan lines per millimetre. */
export const RESOLUTIONS: Resolution[] = [
  { id: 'standard', label: 'Standard', linesPerMm: Number(standardMatch[1]), quote: 't4-standard' },
  { id: 'fine', label: 'Fine', linesPerMm: Number(fineMatch[1]), quote: 't4-higher' },
]
/** How far a page's own pixel count may be from the computed one and still be used as it is: T.4's ± 1%. */
export const TOLERANCE = Number(standardMatch[2]) / 100

/**
 * The resolutions RFC 3949 profile S treats as equivalent, per inch: 200 and 204 across the line, 98 and 100
 * lines down it, and 196 and 200. A TIFF 1728 pels wide at one of those is coded line for line at the
 * resolution its rows belong to.
 */
const xPair = read('rfc-s-x', /^In pixels\/inch, the allowed values are (\d+) and (\d+), which may be treated as equivalent\.$/)
const yPairs = read('rfc-s-y', /(\d+) and (\d+) may be treated as equivalent, and (\d+) and (\d+) may be treated as equivalent\.$/)
const pairs: [number[], number[]] = [
  [Number(yPairs[1]), Number(yPairs[2])],
  [Number(yPairs[3]), Number(yPairs[4])],
]
const [STANDARD, FINE] = RESOLUTIONS as [Resolution, Resolution]
// Each pair belongs to the resolution its lines per millimetre are nearest.
const nearest = (lpi: number[]): ResolutionId =>
  Math.abs((lpi[0] as number) / 25.4 - STANDARD.linesPerMm) < Math.abs((lpi[0] as number) / 25.4 - FINE.linesPerMm) ? 'standard' : 'fine'
if (nearest(pairs[0]) === nearest(pairs[1])) fail('the two pairs of RFC 3949 are not one standard and one fine')
export const EQUIVALENT: { dpi: number[]; standard: number[]; fine: number[] } = {
  dpi: [Number(xPair[1]), Number(xPair[2])],
  standard: nearest(pairs[0]) === 'standard' ? pairs[0] : pairs[1],
  fine: nearest(pairs[0]) === 'fine' ? pairs[0] : pairs[1],
}

/** T.4 4.1.4: "The end of a document transmission is indicated by sending six consecutive EOLs." */
export const RTC_EOLS: number = WORDS[read('t4-rtc', /sending (\w+) consecutive EOLs\.$/)[1] ?? ''] ?? fail('the RTC count is not a number word')

// The code tables: Tables 2 and 3a, clause 4.1.
const terminating = read('t4-terminating', /^Run lengths in the range of (\d+) to (\d+) pels are encoded with their appropriate terminating code word\.$/)
const makeUp = read('t4-make-up', /^Run lengths in the range of (\d+) to (\d+) pels are encoded first by the make-up code word/)
const TERMINATING = Number(terminating[2]) - Number(terminating[1]) + 1
if (Number(terminating[1]) !== 0 || Number(makeUp[1]) !== TERMINATING) fail('the terminating and make-up ranges do not meet')
const MAKE_UP = Number(makeUp[2]) / TERMINATING
if (!Number.isInteger(MAKE_UP) || Number(makeUp[2]) !== LINE.pels) fail('the make-up codes do not run to the scan line in steps of the terminating range')
const eolFormat = read('t4-eol-format', /^Format: ([01]+)$/)[1]

/** Tables 2 and 3a of T.4, the code words the coder writes. */
export const CODES: CodeTables = { white: data.codes.white, black: data.codes.black, eol: data.codes.eol }
if (CODES.eol !== eolFormat) fail('the EOL is not the format clause 4.1.2 gives')
/** A set of code words in which none is the start of another, so a decoder never has to guess. */
function prefixFree(codes: string[]): boolean {
  const sorted = [...codes].sort()
  return sorted.every((c, i) => i === 0 || !c.startsWith(sorted[i - 1] as string))
}
for (const colour of ['white', 'black'] as const) {
  const t = CODES[colour]
  if (t.terminating.length !== TERMINATING || t.makeUp.length !== MAKE_UP)
    fail(`the ${colour} table has ${t.terminating.length} terminating and ${t.makeUp.length} make-up codes`)
  const all = [...t.terminating, ...t.makeUp, CODES.eol]
  if (all.some((c) => !/^[01]+$/.test(c))) fail(`the ${colour} table holds a code word that is not bits`)
  if (!prefixFree(all)) fail(`the ${colour} table is not a prefix code`)
}

export interface DecodeTables {
  /** Table 3b: make-up codes for both colours from `from` in steps of `step`. */
  extended: { from: number; step: number; codes: string[] }
  /** Table 4: the modes of two-dimensional coding. */
  modes: { pass: string; horizontal: string; vertical: Record<string, string> }
}

/** Tables 3b and 4 of T.4, which the TIFF reader decodes fax-coded strips with. */
export const DECODE: DecodeTables = { extended: data.decode.extendedMakeUp, modes: data.decode.modes }
const ext = DECODE.extended
if (
  !prefixFree([...CODES.white.terminating, ...CODES.white.makeUp, ...ext.codes, CODES.eol]) ||
  !prefixFree([...CODES.black.terminating, ...CODES.black.makeUp, ...ext.codes, CODES.eol])
) {
  fail('Table 3b clashes with Tables 2 and 3a')
}
if (ext.from !== LINE.pels + ext.step) fail('Table 3b does not start one step past the scan line')
if (!prefixFree([DECODE.modes.pass, DECODE.modes.horizontal, ...Object.values(DECODE.modes.vertical)])) fail('Table 4 is not a prefix code')

export interface Rate {
  /** Bits per second. */
  bps: number
  /** The modems that run at it, such as "ITU-T V.17". */
  modems: string[]
  /** The ids of the quotes it is read from. */
  quotes: string[]
  /** True for 14 400 bit/s, the rate a call is worked out at when none is given. */
  default: boolean
  /** True for V.34, where T.30 makes error correction mode mandatory, and so the minimum scan line time 0 ms. */
  ecm: boolean
}

/** The modem rates: the DCS cells of T.30 Table 2, bits 11 to 14, and the top of the V.34 title. */
export const RATES: Rate[] = data.rates.map((r) => {
  if (!r.standards.length || !r.quotes.length) fail(`${r.bps} names no modem or no quote`)
  const modems = r.standards.map((id) => MODEMS[id] ?? fail(`${r.bps} names the modem ${id}, which is not listed`))
  const ecm = 'ecm' in r && r.ecm === true
  for (const q of r.quotes) if (!QUOTES[q]) fail(`${r.bps} cites ${q}, which is not a quote`)
  if (ecm) {
    // The figure is the top of the V.34 title, and T.30 makes ECM, and so 0 ms, mandatory with it.
    if (!modems.every((m) => m.title.includes(`up to ${ituRate(r.bps)} bit/s`))) fail(`${r.bps} is not in the title of ${r.standards.join(', ')}`)
    if (!r.quotes.includes('t30-ecm-0ms') || !r.quotes.includes('t30-v34-ecm')) fail(`${r.bps} does not cite the two T.30 sentences on ECM`)
  } else {
    // Each modem the rate names has a DCS cell of Table 2 with that rate and that modem.
    for (const m of modems) {
      const cell = `${ituRate(r.bps)} bit/s, ITU-T Rec. ${m.label.replace(/^ITU-T /, '').replace(/ter$/, ' ter')}`
      if (!r.quotes.some((q) => says(q) === cell)) fail(`${r.bps} cites no DCS cell "${cell}"`)
    }
  }
  return { bps: r.bps, modems: modems.map((m) => m.label), quotes: r.quotes, default: 'default' in r && r.default === true, ecm }
})
if (RATES.filter((r) => r.default).length !== 1) fail('not exactly one default rate')

export interface ScanTime {
  /** Milliseconds. */
  ms: number
  /** The ids of the quotes it is read from: the option first, then the DCS cell. */
  quotes: string[]
  /** True for 20 ms, the standard of T.4 clause 3. */
  default: boolean
}

/** The minimum scan line times: T.4 3.1, Alternative 1, and the DCS cells of T.30 Table 2, bits 21 to 23. */
export const SCAN_TIMES: ScanTime[] = data.scanTimes.map((t) => {
  if (!t.quotes.length) fail(`${t.ms} ms cites no quote`)
  // T.4 3.1 writes "20 milliseconds" and "0 millisecond", the DCS column of T.30 "20 ms". The first time a quote
  // names is the option it is about: the later ones are the fall-backs.
  for (const q of t.quotes) if (Number(/(\d+) (?:milliseconds?|ms)\b/.exec(says(q))?.[1]) !== t.ms) fail(`${q} does not give ${t.ms} ms`)
  return { ms: t.ms, quotes: t.quotes, default: 'default' in t && t.default === true }
})
if (SCAN_TIMES.filter((t) => t.default).length !== 1) fail('not exactly one default scan line time')
// T.4 clause 3: "... in addition to the 20 milliseconds standard."
if (Number(read('t4-scan-standard', /the (\d+) milliseconds standard\.$/)[1]) !== SCAN_TIMES.find((t) => t.default)?.ms)
  fail('the default time is not the standard of clause 3')
if (!SCAN_TIMES.some((t) => t.ms === 0)) fail('no 0 ms time for a rate with error correction')

/** The rate a page is worked out at when none is given: 14 400 bit/s. */
export const DEFAULT_RATE = RATES.find((r) => r.default) as Rate
/** The minimum scan line time when none is given: 20 ms, or 0 ms at a rate with error correction. */
export const DEFAULT_SCAN_TIME = SCAN_TIMES.find((t) => t.default) as ScanTime

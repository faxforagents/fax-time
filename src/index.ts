/**
 * faxforagents-fax-time: how long the page data of a fax takes on the line, from the standards alone.
 *
 * Each page is laid on the T.4 scan line at standard or fine resolution and made black and white. Each scan line
 * is coded with Tables 2 and 3a of T.4 (Modified Huffman) and given its EOL. A line shorter than the minimum scan
 * line time gets fill, and six EOLs end the page. The bits over the modem rate are the seconds. The figure covers
 * the page data only, not the call around it: the answer, the exchange of capabilities, the training, the
 * confirmation after each page and any retry all add time.
 */
import { decoder } from './ccitt.js'
import { lengthsOf, minLineBits, pageBits } from './mh.js'
import { type CodedPage, codePage, type PageSettings } from './page.js'
import { readPbm } from './pbm.js'
import {
  CODES,
  DECODE,
  DEFAULT_RATE,
  DEFAULT_SCAN_TIME,
  EQUIVALENT,
  LINE,
  RATES,
  RESOLUTIONS,
  type ResolutionId,
  RTC_EOLS,
  SCAN_TIMES,
  TOLERANCE,
} from './standards.js'
import { decodePage, openTiff, PageError, type Unreadable } from './tiff.js'

export { CcittError } from './ccitt.js'
export {
  type CodeLengths,
  type CodeTables,
  type Colour,
  type ColourCodes,
  encodeLine,
  fewestLineBits,
  ituRate,
  lengthsOf,
  lineBits,
  minLineBits,
  mostLineBits,
  type PageBits,
  pageBits,
  pageLineBits,
  runBits,
  runCode,
  runs,
  seconds,
} from './mh.js'
export type { CodedPage, PageSettings } from './page.js'
export { type PbmError, type PbmImage, PbmReadError, type PbmResult, readPbm } from './pbm.js'
export { type Placement, place, toPels } from './raster.js'
export {
  CODES,
  DECODE,
  DEFAULT_RATE,
  DEFAULT_SCAN_TIME,
  type DecodeTables,
  EQUIVALENT,
  LINE,
  type Line,
  MODEMS,
  QUOTES,
  type Quote,
  RATES,
  type Rate,
  RESOLUTIONS,
  type Resolution,
  type ResolutionId,
  RTC_EOLS,
  SCAN_TIMES,
  type ScanTime,
  TEXTS,
  type Text,
  TOLERANCE,
} from './standards.js'
export { PageError, type Unreadable } from './tiff.js'
export { type Damage, type Rational, readTiff, type TiffError, type TiffPage, TiffReadError, type TiffResult } from './tiff-read.js'
export { VERSION } from './version.js'

/** The bit lengths of Tables 2 and 3a and of the EOL. */
export const LENGTHS = lengthsOf(CODES)
const DECODER = decoder({ ...CODES, extended: DECODE.extended, modes: DECODE.modes })

/** Bounds on what one file may ask for. They guard memory and time; they come from no standard. */
export interface Limits {
  /** The most pages read from one file. The rest are counted as more. */
  maxPages: number
  /** The most pixels one page may have, and the most pels its scan lines may hold at fine resolution. */
  maxPixels: number
}

/** 1000 pages and 2^26 pixels a page (8192 by 8192), with scan lines held to the same 2^26 pels. */
export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({ maxPages: 1000, maxPixels: 2 ** 26 })

const limitsOf = (l: Partial<Limits> = {}): Limits => {
  const out = { ...DEFAULT_LIMITS, ...l }
  for (const [k, v] of Object.entries(out)) if (!Number.isInteger(v) || v < 1) throw new RangeError(`${k} must be a whole number of 1 or more, not ${v}`)
  return out
}

const pageSettings = (limits: Limits): PageSettings => ({
  line: LINE,
  linesPerMm: { standard: (RESOLUTIONS[0] as { linesPerMm: number }).linesPerMm, fine: (RESOLUTIONS[1] as { linesPerMm: number }).linesPerMm },
  tolerance: TOLERANCE,
  maxPixels: limits.maxPixels,
  equivalent: EQUIVALENT,
})

/** The rate, the minimum scan line time and the resolution a page is worked out at. */
export interface Settings {
  /** Standard (3.85 lines/mm) or fine (7.7 lines/mm). */
  resolution: ResolutionId
  /** The modem rate in bit/s: one of RATES. */
  bps: number
  /** The minimum scan line time in milliseconds: one of SCAN_TIMES, and 0 at a rate with error correction. */
  ms: number
}

/**
 * Settings checked against the standards, with the defaults filled in: standard resolution, 14 400 bit/s and
 * 20 ms. At 33 600 bit/s (V.34) T.30 makes error correction mandatory, so the time is 0 ms and no other.
 */
export function settings(s: Partial<Settings> = {}): Settings {
  const bps = s.bps ?? DEFAULT_RATE.bps
  const rate = RATES.find((r) => r.bps === bps)
  if (!rate) throw new RangeError(`${bps} bit/s is not a rate of T.30 Table 2 or V.34. The rates are ${RATES.map((r) => r.bps).join(', ')}`)
  const ms = s.ms ?? (rate.ecm ? 0 : DEFAULT_SCAN_TIME.ms)
  if (!SCAN_TIMES.some((t) => t.ms === ms))
    throw new RangeError(`${ms} ms is not a minimum scan line time of T.4 3.1. The times are ${SCAN_TIMES.map((t) => t.ms).join(', ')}`)
  if (rate.ecm && ms !== 0) throw new RangeError(`${bps} bit/s runs only with error correction, which T.30 gives a minimum scan line time of 0 ms`)
  const resolution = s.resolution ?? 'standard'
  if (!RESOLUTIONS.some((r) => r.id === resolution)) throw new RangeError(`the resolution is standard or fine, not ${resolution}`)
  return { resolution, bps, ms }
}

/** The bits and seconds of one page on the line. */
export interface PageTime {
  /** 1 for the first page of a file. */
  page: number
  resolution: ResolutionId
  bps: number
  ms: number
  /** Scan lines on the page. */
  lines: number
  /** Code words and EOLs: the EOL before the first line, each line's data and EOL, and the rest of the RTC. */
  coded: number
  /** Zeros added so each line takes the minimum scan line time. */
  fill: number
  /** coded + fill. */
  bits: number
  /** bits / bps. */
  seconds: number
  /** True when the page gave no usable resolution and was taken as the full width of the line, with square pixels. */
  assumed: boolean
}

/** The bits and seconds of a coded page at the given settings. A change of settings needs no second coding. */
export function timePage(page: CodedPage, s: Partial<Settings> = {}): PageTime {
  const { resolution, bps, ms } = settings(s)
  const b = pageBits(resolution === 'fine' ? page.fine : page.standard, LENGTHS.eol, RTC_EOLS, minLineBits(bps, ms))
  return { page: page.number, resolution, bps, ms, lines: b.lines, coded: b.coded, fill: b.fill, bits: b.total, seconds: b.total / bps, assumed: page.assumed }
}

/** Pixels per inch across and down. */
export interface Dpi {
  x: number
  y: number
}

/** A 1-bit page. */
export interface Bitmap {
  width: number
  height: number
  /** width × height bytes, row by row from the top: 0 for white, anything else for black. */
  pixels: Uint8Array
  /**
   * Pixels per inch, when known. A bitmap 1728 pixels wide at 200 or 204 across and 98 or 100 down (standard) or
   * 196 or 200 down (fine) is coded row for row. Without a resolution the page is taken as the full width of the
   * scan line, with square pixels.
   */
  dpi?: Dpi | null
}

export interface CodeOptions {
  limits?: Partial<Limits>
  /** The resolution of a page that gives none, such as every PBM page. */
  dpi?: Dpi | null
}

const checkDpi = (dpi: Dpi | null | undefined): Dpi | null => {
  if (dpi == null) return null
  if (!(Number.isFinite(dpi.x) && dpi.x > 0 && Number.isFinite(dpi.y) && dpi.y > 0)) throw new RangeError(`a resolution of ${dpi.x} by ${dpi.y} per inch`)
  return { x: dpi.x, y: dpi.y }
}
const mmOf = (width: number, height: number, dpi: Dpi | null): { width: number; height: number } | null =>
  dpi ? { width: (width * 25.4) / dpi.x, height: (height * 25.4) / dpi.y } : null

/** The data bits of every scan line of a 1-bit page, at standard and at fine resolution. */
export function codeBitmap(bitmap: Bitmap, options: CodeOptions & { page?: number } = {}): CodedPage {
  const limits = limitsOf(options.limits)
  const { width, height, pixels } = bitmap
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new PageError('no-size')
  if (width * height > limits.maxPixels) throw new PageError('too-large')
  if (!(pixels instanceof Uint8Array) || pixels.length < width * height) throw new RangeError('fewer pixels than the page size')
  const dpi = checkDpi(bitmap.dpi ?? options.dpi)
  const grey = new Uint8Array(width * height)
  for (let i = 0; i < grey.length; i++) grey[i] = pixels[i] ? 0 : 255
  return codePage(options.page ?? 1, grey, width, height, mmOf(width, height, dpi), true, pageSettings(limits), LENGTHS, dpi)
}

/** A page that could not be read. The pages before it were read, and none after it is. */
export interface PageFailure {
  page: number
  kind: Unreadable | 'not-pbm'
  detail: string
}

export interface CodedFile {
  format: 'tiff' | 'pbm'
  pages: CodedPage[]
  /** True when the file has more pages than maxPages. Only the first maxPages are coded. */
  more: boolean
  /** For a TIFF, why its chain of pages ended early, after the pages it holds. Null when it ended normally. */
  damage: string | null
  failed: PageFailure | null
}

/** The scan lines of every page of a TIFF, one page after another. */
export async function codeTiff(bytes: Uint8Array, options: CodeOptions = {}): Promise<CodedFile> {
  const limits = limitsOf(options.limits)
  const fallback = checkDpi(options.dpi)
  const s = pageSettings(limits)
  const { result, ifds, little } = openTiff(bytes, limits.maxPages)
  const pages: CodedPage[] = []
  for (const [i, page] of result.pages.entries()) {
    try {
      const g = await decodePage(bytes, page, ifds[i] as number, little, { maxPixels: limits.maxPixels, decoder: DECODER })
      const own = g.mm === null && fallback ? { mm: mmOf(g.width, g.height, fallback), dpi: fallback } : { mm: g.mm, dpi: g.dpi }
      pages.push(codePage(page.number, g.grey, g.width, g.height, own.mm, true, s, LENGTHS, own.dpi))
    } catch (err) {
      const failed =
        err instanceof PageError
          ? { page: page.number, kind: err.kind, detail: err.detail }
          : { page: page.number, kind: 'damaged' as const, detail: err instanceof Error ? err.message : '' }
      return { format: 'tiff', pages, more: result.more, damage: result.damage, failed }
    }
  }
  return { format: 'tiff', pages, more: result.more, damage: result.damage, failed: null }
}

/** The scan lines of every image of a PBM file. */
export function codePbm(bytes: Uint8Array, options: CodeOptions = {}): CodedFile {
  const limits = limitsOf(options.limits)
  const dpi = checkDpi(options.dpi)
  const read = readPbm(bytes, limits.maxPages, limits.maxPixels)
  const pages: CodedPage[] = []
  for (const [i, image] of read.images.entries()) {
    try {
      pages.push(codeBitmap({ ...image, dpi }, { limits, page: i + 1 }))
    } catch (err) {
      const failed =
        err instanceof PageError
          ? { page: i + 1, kind: err.kind, detail: err.detail }
          : { page: i + 1, kind: 'damaged' as const, detail: err instanceof Error ? err.message : '' }
      return { format: 'pbm', pages, more: false, damage: null, failed }
    }
  }
  const failed = read.stopped
    ? { page: read.stopped.image, kind: read.stopped.kind === 'not-pbm' ? ('not-pbm' as const) : read.stopped.kind, detail: read.stopped.detail }
    : null
  return { format: 'pbm', pages, more: read.more, damage: null, failed }
}

/** Thrown when a file is neither a TIFF nor a PBM. */
export class FormatError extends Error {
  readonly format: 'pdf' | 'unknown'
  constructor(format: 'pdf' | 'unknown') {
    super(format === 'pdf' ? 'a PDF, which this version does not read: render it to a TIFF or PBM first' : 'neither a TIFF nor a PBM')
    this.format = format
  }
}

/** The scan lines of every page of a TIFF or PBM file, told apart by their first bytes. */
export async function codeFile(bytes: Uint8Array, options: CodeOptions = {}): Promise<CodedFile> {
  const head = String.fromCharCode(...bytes.subarray(0, 4))
  if (head.startsWith('II') || head.startsWith('MM')) return codeTiff(bytes, options)
  if (head.startsWith('P1') || head.startsWith('P4')) return codePbm(bytes, options)
  throw new FormatError(head === '%PDF' ? 'pdf' : 'unknown')
}

export interface FileTime {
  format: 'tiff' | 'pbm' | 'bitmap'
  settings: Settings
  pages: PageTime[]
  /** The bits of all pages. */
  bits: number
  /** The seconds of all pages, page data only. */
  seconds: number
  more: boolean
  damage: string | null
  failed: PageFailure | null
}

/** The bits and seconds of every coded page of a file at the given settings. */
export function timeFile(file: CodedFile, s: Partial<Settings> = {}): FileTime {
  const checked = settings(s)
  const pages = file.pages.map((p) => timePage(p, checked))
  const bits = pages.reduce((n, p) => n + p.bits, 0)
  return { format: file.format, settings: checked, pages, bits, seconds: bits / checked.bps, more: file.more, damage: file.damage, failed: file.failed }
}

/**
 * The seconds of page data of a TIFF or PBM file, given as its bytes, or of one 1-bit bitmap, at the given rate,
 * minimum scan line time and resolution.
 */
export async function faxTime(input: Uint8Array | Bitmap, options: Partial<Settings> & CodeOptions = {}): Promise<FileTime> {
  const s = settings(options)
  if (input instanceof Uint8Array) return timeFile(await codeFile(input, options), s)
  const page = timePage(codeBitmap(input, options), s)
  return { format: 'bitmap', settings: s, pages: [page], bits: page.bits, seconds: page.seconds, more: false, damage: null, failed: null }
}

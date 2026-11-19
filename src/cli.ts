#!/usr/bin/env node
/**
 * fax-time <file>: the seconds of page data of each page of a TIFF or PBM file on a fax line.
 *
 * Exit 0 when every page was read, 1 when the file or any of its pages could not be read, 2 for a wrong argument.
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import {
  codeFile,
  DEFAULT_LIMITS,
  type Dpi,
  type FileTime,
  FormatError,
  ituRate,
  PbmReadError,
  RATES,
  SCAN_TIMES,
  settings,
  TiffReadError,
  timeFile,
  VERSION,
} from './index.js'

const HELP = `Usage: fax-time [options] <file>

Prints how long the page data of each page of a TIFF or PBM file takes on a
fax line, worked out from ITU-T T.4 and T.30. This covers the page data only,
not the call around it.

Options:
  -r, --rate <bit/s>        ${RATES.map((r) => r.bps).join(', ')} (default ${RATES.find((r) => r.default)?.bps})
  -t, --scan-time <ms>      minimum scan line time: ${SCAN_TIMES.map((t) => t.ms).join(', ')} (default ${SCAN_TIMES.find((t) => t.default)?.ms}, 0 at a rate with error correction)
  -f, --fine                fine resolution, the same as --resolution fine
      --resolution <name>   standard (default) or fine
      --dpi <x>[x<y>]       the resolution of a page that gives none, such as a PBM page
      --max-pages <n>       the most pages read from the file (default ${DEFAULT_LIMITS.maxPages})
      --json                print the result as JSON
  -h, --help                print this help
  -v, --version             print the version
`

const out = (line: string): void => {
  process.stdout.write(`${line}\n`)
}
const err = (line: string): void => {
  process.stderr.write(`fax-time: ${line}\n`)
}

function dpiOf(text: string): Dpi {
  const m = /^(\d+(?:\.\d+)?)(?:x(\d+(?:\.\d+)?))?$/.exec(text)
  const x = Number(m?.[1])
  const y = m?.[2] === undefined ? x : Number(m[2])
  if (!m || !(x > 0 && y > 0 && Number.isFinite(x) && Number.isFinite(y)))
    throw new RangeError(`--dpi takes a resolution above 0, such as 204x98 or 300, not ${text}`)
  return { x, y }
}

function whole(name: string, text: string | undefined): number | undefined {
  if (text === undefined) return undefined
  const n = Number(text)
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(n))
    throw new RangeError(`${name} takes a whole number, not ${text.length > 20 ? `${text.slice(0, 20)}...` : text}`)
  return n
}

const pages = (n: number): string => (n === 1 ? '1 page' : `${n} pages`)

function print(t: FileTime): void {
  for (const p of t.pages) out(`page ${p.page}: ${p.seconds.toFixed(1)} s, ${p.bits} bits (${p.coded} coded, ${p.fill} fill), ${p.lines} lines`)
  const { bps, ms, resolution } = t.settings
  out(`total: ${t.seconds.toFixed(1)} s for ${pages(t.pages.length)} at ${ituRate(bps)} bit/s, ${resolution} resolution, ${ms} ms minimum scan line time`)
  out('This covers the page data only, not the call around it.')
}

const WHY: Record<string, string> = {
  tiles: 'it is stored in tiles, which this reader does not read',
  compression: 'its compression is one this reader does not read',
  depth: 'its bit depth is one this reader does not read',
  photometric: 'its colour model is one this reader does not read',
  strips: 'its strips are missing or point outside the file',
  damaged: 'its image data breaks off or does not decode',
  'too-large': 'it has more pixels or scan lines than the limit',
  'no-size': 'it gives no width or height',
  'not-pbm': 'it is not a PBM image',
}

async function main(argv: string[]): Promise<number> {
  let args: ReturnType<typeof parse>
  try {
    args = parse(argv)
  } catch (e) {
    err(e instanceof Error ? e.message : String(e))
    process.stderr.write(HELP)
    return 2
  }
  const { values, positionals } = args
  if (values.help) {
    out(HELP.trimEnd())
    return 0
  }
  if (values.version) {
    out(VERSION)
    return 0
  }
  if (positionals.length !== 1) {
    err(positionals.length ? 'give one file' : 'give a file')
    process.stderr.write(HELP)
    return 2
  }
  let s: ReturnType<typeof settings>
  let dpi: Dpi | undefined
  let maxPages: number | undefined
  try {
    if (values.resolution !== undefined && values.resolution !== 'standard' && values.resolution !== 'fine') {
      throw new RangeError(`--resolution is standard or fine, not ${values.resolution || 'empty'}`)
    }
    if (values.fine && values.resolution === 'standard') throw new RangeError('--fine and --resolution standard disagree')
    const resolution = values.fine ? 'fine' : values.resolution
    s = settings({
      bps: whole('--rate', values.rate),
      ms: whole('--scan-time', values['scan-time']),
      resolution: resolution as 'standard' | 'fine' | undefined,
    })
    dpi = values.dpi === undefined ? undefined : dpiOf(values.dpi)
    maxPages = whole('--max-pages', values['max-pages'])
    if (maxPages === 0) throw new RangeError('--max-pages takes 1 or more')
  } catch (e) {
    err(e instanceof Error ? e.message : String(e))
    return 2
  }
  const file = positionals[0] as string
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(readFileSync(file))
  } catch (e) {
    err(`cannot read ${file}: ${e instanceof Error && 'code' in e ? (e as NodeJS.ErrnoException).code : String(e)}`)
    return 1
  }
  let t: FileTime
  try {
    t = timeFile(await codeFile(bytes, { dpi, limits: { maxPages } }), s)
  } catch (e) {
    if (e instanceof FormatError) err(`${file} is ${e.message}`)
    else if (e instanceof TiffReadError)
      err(`${file} is ${e.kind === 'bigtiff' ? 'a BigTIFF, which this reader does not read' : e.kind === 'not-tiff' ? 'not a TIFF' : 'a damaged TIFF'}`)
    else if (e instanceof PbmReadError) err(`${file} is not a PBM: ${e.message}`)
    else err(`${file} could not be read: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
  if (values.json) out(JSON.stringify(t, null, 2))
  else if (t.pages.length) print(t)
  const assumed = t.pages.filter((p) => p.assumed).map((p) => p.page)
  if (assumed.length && !values.json)
    err(
      `${assumed.length === t.pages.length ? 'the file gives' : `${pages(assumed.length)} give`} no size on paper, so ${assumed.length === 1 ? 'the page was' : 'they were'} taken as the full width of the scan line. Pass --dpi to give a resolution.`,
    )
  if (t.more && !t.failed) err(`the file has more pages than the limit, and only the first ${t.pages.length} were read. --max-pages raises it`)
  if (t.damage) err(`the file's chain of pages ends early (${t.damage}), so any page after the last one found is missing`)
  if (t.failed) err(`page ${t.failed.page} could not be read: ${WHY[t.failed.kind] ?? t.failed.kind}${t.failed.detail ? ` (${t.failed.detail})` : ''}`)
  return t.failed || t.more || t.damage ? 1 : 0
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      rate: { type: 'string', short: 'r' },
      'scan-time': { type: 'string', short: 't' },
      fine: { type: 'boolean', short: 'f' },
      resolution: { type: 'string' },
      dpi: { type: 'string' },
      'max-pages': { type: 'string' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code
  },
  (e: unknown) => {
    err(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  },
)

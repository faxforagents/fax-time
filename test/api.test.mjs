// The public API: limits, bitmaps, the inputs it takes, and the module refusing data that does not say its figures.
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { codeBitmap, codeFile, DEFAULT_LIMITS, FormatError, faxTime, LENGTHS, lineBits, runBits, timePage } from '../dist/index.js'
import { fixture, ROOT } from './helpers.mjs'

const dir = mkdtempSync(join(tmpdir(), 'fax-time-api-'))
after(() => rmSync(dir, { recursive: true, force: true }))

test('limits: an undefined limit keeps its default, and a limit that is not a whole number is refused', async () => {
  assert.deepEqual(DEFAULT_LIMITS, { maxPages: 1000, maxPixels: 2 ** 26, maxFilePixels: 2 ** 30 })
  const bytes = fixture('g4-3-pages.tif')
  assert.equal((await codeFile(bytes, { limits: { maxPages: undefined } })).pages.length, 3)
  await assert.rejects(codeFile(bytes, { limits: { maxPages: 0 } }), RangeError)
  await assert.rejects(codeFile(bytes, { limits: { maxPixels: 1.5 } }), RangeError)
  const one = await codeFile(bytes, { limits: { maxPages: 1 } })
  assert.deepEqual([one.pages.length, one.more], [1, true])
})

test('a bitmap: any byte that is not 0 is black, its own resolution wins, and clamped arrays are taken', () => {
  const ones = codeBitmap({ width: 4, height: 4, pixels: new Uint8Array(16).fill(1), dpi: { x: 204, y: 98 } })
  const nines = codeBitmap({ width: 4, height: 4, pixels: new Uint8Array(16).fill(9), dpi: { x: 204, y: 98 } })
  assert.deepEqual([...nines.standard], [...ones.standard])
  const own = codeBitmap({ width: 1728, height: 98, pixels: new Uint8Array(1728 * 98), dpi: { x: 204, y: 98 } }, { dpi: { x: 300, y: 300 } })
  assert.equal(own.standard.length, 98)
  const clamped = codeBitmap({ width: 4, height: 4, pixels: new Uint8ClampedArray(16).fill(1), dpi: { x: 204, y: 98 } })
  assert.deepEqual([...clamped.standard], [...ones.standard])
  assert.throws(() => codeBitmap({ width: 4, height: 4, pixels: [1, 2, 3] }), RangeError)
  assert.throws(() => codeBitmap({ width: 4, height: 4, pixels: new Uint8Array(3) }), RangeError)
  assert.throws(() => codeBitmap({ width: 0, height: 4, pixels: new Uint8Array(0) }), { kind: 'no-size' })
  assert.throws(() => codeBitmap({ width: 4, height: 4, pixels: new Uint8Array(16), dpi: { x: 0, y: 98 } }), RangeError)
  assert.throws(() => codeBitmap({ width: 9000, height: 9000, pixels: new Uint8Array(1) }), { kind: 'too-large' })
})

test('faxTime takes bytes as a Uint8Array, a Buffer or an ArrayBuffer, and names a file it does not read', async () => {
  const bytes = fixture('g4-fine.tif')
  const a = await faxTime(bytes, { resolution: 'fine' })
  const b = await faxTime(Buffer.from(bytes), { resolution: 'fine' })
  const c = await faxTime(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { resolution: 'fine' })
  assert.deepEqual([b.bits, c.bits], [a.bits, a.bits])
  assert.equal(a.pages[0].bits, 132091 + 501581)
  await assert.rejects(faxTime(new TextEncoder().encode('%PDF-1.7')), (e) => e instanceof FormatError && e.format === 'pdf')
  await assert.rejects(faxTime(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), (e) => e instanceof FormatError && e.format === 'unknown')
  await assert.rejects(faxTime(bytes, { bps: 33600, ms: 20 }), RangeError)
})

test('timePage works any setting out of one coding of a page', async () => {
  const { pages } = await codeFile(fixture('g3-standard.tif'))
  const fast = timePage(pages[0], { bps: 33600 })
  const slow = timePage(pages[0], { bps: 2400, ms: 40 })
  assert.deepEqual([fast.fill, fast.ms, fast.coded], [0, 0, 63786])
  assert.equal(slow.bits, 63786 + slow.fill)
  assert.ok(slow.fill > 0 && slow.seconds > fast.seconds)
})

test('the low-level coder refuses a run or a line it cannot code, never counting it as white', () => {
  assert.throws(() => runBits(-1, 0, LENGTHS), RangeError)
  assert.throws(() => runBits(2.5, 1, LENGTHS), RangeError)
  assert.throws(() => lineBits(new Uint8Array(1), 2, LENGTHS), RangeError)
  assert.throws(() => lineBits(new Uint8Array(4), 2, LENGTHS, 3), RangeError)
  assert.equal(lineBits(new Uint8Array(4), 2, LENGTHS, 2), lineBits(new Uint8Array(2), 2, LENGTHS))
})

test('the module will not load when a quote no longer says its figure', async () => {
  const copy = join(dir, 'dist')
  cpSync(join(ROOT, 'dist'), copy, { recursive: true })
  const data = join(copy, 'standards-data.js')
  const text = readFileSync(data, 'utf8')
  const changed = text.replace('sending six consecutive EOLs.', 'sending seven consecutive EOLs and a tone.')
  assert.notEqual(changed, text)
  writeFileSync(data, changed)
  await assert.rejects(import(pathToFileURL(join(copy, 'standards.js')).href), /t4-rtc no longer says what this module reads from it/)
})

// The TIFF reader and decoder: what libtiff writes, the resolutions coded line for line, and damaged files.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { deflateSync } from 'node:zlib'
import { decoder } from '../dist/ccitt.js'
import { CODES, codeTiff, DECODE, readTiff, TiffReadError, timePage } from '../dist/index.js'
import { decodePage, openTiff } from '../dist/tiff.js'
import { EXPECTED, fax, fixture, tiff, tiffWithStrip } from './helpers.mjs'

const D = decoder({ ...CODES, extended: DECODE.extended, modes: DECODE.modes })
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** The grey pixels of the first page of a file, or the kind of error it gives. */
async function firstPage(bytes, maxPixels = 2 ** 26) {
  const f = openTiff(bytes, 1000)
  try {
    return await decodePage(bytes, f.result.pages[0], f.ifds[0], f.little, { maxPixels, decoder: D })
  } catch (err) {
    return { error: err.kind ?? err.message }
  }
}

test('the reader: pages, byte order, and the first entry of a repeated tag', () => {
  const s = readTiff(tiff([fax(), fax()]), 200)
  assert.deepEqual([s.pages.length, s.byteOrder, s.more, s.damage], [2, 'II', false, null])
  assert.deepEqual([s.pages[0].width, s.pages[0].length, s.pages[0].compression, s.pages[0].fillOrder], [1728, 2200, 3, 2])
  assert.deepEqual(s.pages[0].xResolution, { num: 204, den: 1 })
  const mm = readTiff(tiff([fax()], { order: 'MM' }), 200)
  assert.deepEqual([mm.byteOrder, mm.pages[0].width], ['MM', 1728])
  assert.equal(
    readTiff(
      tiff([
        [
          [256, 3, [60000]],
          [256, 3, [1728]],
        ],
      ]),
      200,
    ).pages[0].width,
    60000,
  )
})

test('the reader refuses what is not a TIFF and stops a damaged chain without reading past it', () => {
  const errorOf = (bytes) => {
    try {
      readTiff(bytes, 200)
      return 'none'
    } catch (err) {
      return err instanceof TiffReadError ? `${err.kind}${err.damage ? `/${err.damage}` : ''}` : 'thrown'
    }
  }
  assert.deepEqual([errorOf(new TextEncoder().encode('%PDF-1.7 hello')), errorOf(new Uint8Array(3))], ['not-tiff', 'not-tiff'])
  assert.equal(errorOf(tiff([fax()], { magic: 43 })), 'bigtiff')
  const good = tiff([fax(), fax()])
  assert.equal(errorOf(good.slice(0, 40)), 'damaged/truncated')
  const second = readTiff(good.slice(0, good.length - 20), 200)
  assert.deepEqual([second.pages.length, second.damage], [1, 'truncated'])
  const looped = readTiff(tiff([fax()], { next: 8 }), 200)
  assert.deepEqual([looped.pages.length, looped.damage], [1, 'loop'])
  const outside = readTiff(tiff([fax()], { next: 1_000_000 }), 200)
  assert.deepEqual([outside.pages.length, outside.damage], [1, 'outside'])
  const long = readTiff(tiff(Array.from({ length: 4 }, () => fax())), 3)
  assert.deepEqual([long.pages.length, long.more], [3, true])
})

test('the reader marks a tag unreadable when its values run past the end or divide by zero', () => {
  const short = tiff([[[256, 4, [1728, 1728, 1728, 1728, 1728, 1728, 1728, 1728, 1728]]]])
  new DataView(short.buffer).setUint32(8 + 2 + 4, 100000, true)
  assert.deepEqual(readTiff(short, 200).pages[0].unreadable, [256])
  const wild = tiff([
    [
      [256, 3, [1728]],
      [258, 3, [1, 1, 1, 1]],
    ],
  ])
  new DataView(wild.buffer).setUint32(8 + 2 + 12 + 8, 0x7fffffff, true)
  assert.deepEqual(readTiff(wild, 200).pages[0].unreadable, [258])
  assert.deepEqual(readTiff(tiff([fax().map(([t, ty, v]) => (t === 282 ? [t, ty, [[204, 0]]] : [t, ty, v]))]), 200).pages[0].unreadable, [282])
  const junk = tiff([fax()])
  for (let k = 0; k < 10; k++) new DataView(junk.buffer).setUint16(8 + 2 + k * 12 + 2, 7, true)
  assert.equal(readTiff(junk, 200).pages[0].unreadable.length, 10)
})

test('every compression libtiff writes decodes to the pixels Pillow reads, in either fill order', async () => {
  const files = Object.entries(EXPECTED.decode)
  assert.equal(files.length, 12)
  for (const [file, want] of files) {
    const g = await firstPage(fixture(file))
    assert.equal(sha(g.grey), want.sha, file)
    const coded = await codeTiff(fixture(file))
    // 1728 by 300 at 204 by 98 per inch is coded pixel for pixel.
    assert.equal(coded.pages[0].standard.length, want.lines, file)
  }
})

test('each of the eight orientations is read the way Pillow turns it', async () => {
  for (const [file, want] of Object.entries(EXPECTED.orientation)) assert.equal(sha((await firstPage(fixture(file))).grey), want.sha, file)
})

test('a fax TIFF at the resolutions RFC 3949 treats as equivalent is coded line for line', async () => {
  for (const [file, want] of Object.entries(EXPECTED['line-for-line'])) {
    const { pages } = await codeTiff(fixture(file))
    assert.deepEqual([pages[0].standard.length, pages[0].fine.length, pages[0].assumed], [want.standard, want.fine, false], file)
  }
})

test('a TIFF with no photometric tag is read as WhiteIsZero, as Pillow reads it', async () => {
  const g = await firstPage(tiffWithStrip(40, 10, { 258: [3, [8]], 259: [3, [1]] }, new Uint8Array(400).fill(30)))
  assert.deepEqual([...new Set(g.grey)], [225])
})

test('a damaged or oversized TIFF is refused, or read within its own bounds, in little time', async () => {
  const started = performance.now()
  // One pixel wide and a thousand high, no resolution: taken as 215 mm wide, so metres tall.
  const tall = tiffWithStrip(1, 1000, { 258: [3, [8]], 259: [3, [1]], 262: [3, [1]] }, new Uint8Array(1000))
  assert.equal((await codeTiff(tall)).failed?.kind, 'too-large')
  // Group 4 vertical codes that never move along a line of 2 pels.
  const bits = `${'010'.repeat(4000)}1${'0'.repeat(7)}`
  const loop = new Uint8Array(bits.length / 8)
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') loop[i >> 3] |= 0x80 >> (i & 7)
  assert.equal((await firstPage(tiffWithStrip(2, 1, { 258: [3, [1]], 259: [3, [4]], 262: [3, [0]] }, loop))).error, 'damaged')
  // PackBits asking for two copies of a byte the strip does not hold.
  assert.equal((await firstPage(tiffWithStrip(2, 1, { 258: [3, [8]], 259: [3, [32773]], 262: [3, [1]] }, new Uint8Array([0xff])))).error, 'damaged')
  // RGB with 65535 samples a pixel.
  const samples = tiffWithStrip(100, 100, { 258: [3, [8, 8, 8]], 259: [3, [32773]], 262: [3, [2]], 277: [3, [65535]] }, new Uint8Array(64).fill(0x80))
  assert.equal((await firstPage(samples)).error, 'photometric')
  // One grey pixel whose Deflate strip would inflate to 64 MiB and then breaks off: only the one byte is taken.
  const zeros = deflateSync(new Uint8Array(64 * 1024 * 1024), { level: 9 })
  const g = await firstPage(tiffWithStrip(1, 1, { 258: [3, [8]], 259: [3, [8]], 262: [3, [1]] }, zeros.subarray(0, zeros.length - 100)))
  assert.deepEqual([...g.grey], [0])
  // A page over the pixel limit is refused before its strips are read.
  assert.equal((await firstPage(tiffWithStrip(4000, 4000, { 258: [3, [1]], 259: [3, [1]] }, new Uint8Array(8)), 1_000_000)).error, 'too-large')
  assert.ok(performance.now() - started < 10_000, 'the damaged files took too long')
})

test('a file stops at its first bad page and keeps the pages before it', async () => {
  const good = fixture('g4-3-pages.tif')
  const all = await codeTiff(good, { limits: { maxPages: 2 } })
  assert.deepEqual([all.pages.length, all.more, all.failed], [2, true, null])
  // A strip offset pointing past the end of the file, on the second page.
  const f = openTiff(good, 10)
  const bytes = good.slice()
  const view = new DataView(bytes.buffer)
  const ifd = f.ifds[1]
  const n = view.getUint16(ifd, f.little)
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12
    if (view.getUint16(e, f.little) === 273) view.setUint32(e + 8, bytes.length + 10, f.little)
  }
  const cut = await codeTiff(bytes)
  assert.deepEqual([cut.pages.length, cut.failed?.page, cut.failed?.kind], [1, 2, 'strips'])
})

test('a page with no resolution takes the one passed in its place', async () => {
  const pixels = new Uint8Array(1728 * 1100).fill(0)
  const strip = new Uint8Array((1728 / 8) * 1100)
  for (let i = 0; i < pixels.length; i++) if (pixels[i]) strip[i >> 3] |= 0x80 >> (i & 7)
  const bytes = tiffWithStrip(1728, 1100, { 258: [3, [1]], 259: [3, [1]], 262: [3, [0]] }, strip)
  const without = await codeTiff(bytes)
  assert.deepEqual([without.pages[0].assumed, without.pages[0].standard.length], [true, 527])
  const given = await codeTiff(bytes, { dpi: { x: 204, y: 98 } })
  assert.deepEqual([given.pages[0].assumed, given.pages[0].standard.length], [false, 1100])
  assert.equal(timePage(given.pages[0]).coded, 12 + 1100 * (17 + 12) + 5 * 12)
})

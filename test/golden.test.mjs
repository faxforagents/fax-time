// Golden cases: the numbers the fax time tool at https://faxforagents.com/tools/fax-time/ gives for the same
// inputs. Each figure below was worked out three ways and agreed: by the tool's own coder, by this package and by
// scripts/make-fixtures.py, which codes Pillow's pixels on its own.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Bits, decoder, fill, line1d } from '../dist/ccitt.js'
import {
  CODES,
  codeBitmap,
  codeTiff,
  DECODE,
  encodeLine,
  faxTime,
  fewestLineBits,
  ituRate,
  LENGTHS,
  LINE,
  lineBits,
  minLineBits,
  mostLineBits,
  pageBits,
  place,
  RATES,
  RTC_EOLS,
  SCAN_TIMES,
  TOLERANCE,
  timePage,
  toPels,
} from '../dist/index.js'
import { EXPECTED, fixture, line } from './helpers.mjs'

const W = CODES.white
const B = CODES.black
const STD = 3.85

test('the scan line and the RTC are the figures of T.4', () => {
  assert.deepEqual(LINE, { pels: 1728, mm: 215 })
  assert.equal(RTC_EOLS, 6)
  assert.equal(TOLERANCE, 0.01)
  assert.equal(LENGTHS.eol, 12)
})

test('lines coded as T.4 4.1.1 says: white first, a white 0 before black, make-up then terminating past 63', () => {
  assert.equal(encodeLine(line([1728]), 1728, CODES), W.makeUp.at(-1) + W.terminating[0])
  assert.equal(
    encodeLine(line([0, 10, 1718]), 1728, CODES),
    W.terminating[0] + B.terminating[10] + W.makeUp[(1718 - (1718 % 64)) / 64 - 1] + W.terminating[1718 % 64],
  )
  const head = W.terminating[63] + B.makeUp[0] + B.terminating[0]
  assert.equal(encodeLine(line([63, 64, 1728 - 127]), 1728, CODES).slice(0, head.length), head)
})

test('the decoder reads back what the encoder writes', () => {
  const d = decoder({ ...CODES, extended: DECODE.extended, modes: DECODE.modes })
  for (const want of [[1728], [0, 1728], [1, 1, 1726], [700, 328, 700], [0, 1664, 64]]) {
    const row = line(want)
    const coded = encodeLine(row, 1728, CODES)
    assert.equal(coded.length, lineBits(row, 1728, LENGTHS), String(want))
    const bytes = new Uint8Array(Math.ceil(coded.length / 8) + 2)
    for (let i = 0; i < coded.length; i++) if (coded[i] === '1') bytes[i >> 3] |= 0x80 >> (i & 7)
    const back = new Uint8Array(1728)
    fill(line1d(new Bits(bytes, false), 1728, d), 1728, back, 0)
    assert.deepEqual([...back], [...row], String(want))
  }
})

test('the bits of a page: an EOL before the first line, one after each, fill, then the RTC', () => {
  const blank = lineBits(line([1728]), 1728, LENGTHS)
  assert.equal(blank, 17)
  const least = minLineBits(14400, 20)
  assert.equal(least, 288)
  assert.deepEqual(pageBits(new Uint32Array(1000).fill(blank), 12, 6, least), {
    lines: 1000,
    coded: 12 + 1000 * (blank + 12) + 5 * 12,
    fill: 1000 * (least - blank - 12),
    total: 1000 * least + 6 * 12,
  })
  assert.equal(pageBits([blank, 900], 12, 6, minLineBits(33600, 0)).fill, 0)
  assert.deepEqual([ituRate(2400), ituRate(14400), ituRate(33600)], ['2400', '14 400', '33 600'])
})

test('placement: US Letter is scaled to the line, A4 sits inside it, a fax TIFF keeps its pixels', () => {
  assert.deepEqual(place(215.9, 279.4, STD, LINE, TOLERANCE), { cols: 1728, left: 0, lines: Math.round(279.4 * (215 / 215.9) * STD) })
  assert.equal(place(215.9, 279.4, STD, LINE, TOLERANCE).lines, 1071)
  assert.equal(place(210, 297, STD, LINE, TOLERANCE).lines, 1143)
  assert.deepEqual(place((1728 / 204) * 25.4, (1100 / 98) * 25.4, STD, LINE, TOLERANCE, { width: 1728, height: 1100 }), { cols: 1728, left: 0, lines: 1100 })
})

test('black and white by area: a half black page, an average, and mid-grey is white', () => {
  const grey = new Uint8Array(16).fill(255)
  grey.fill(0, 8)
  assert.deepEqual([...toPels(grey, 4, 4, { cols: 2, left: 0, lines: 2 }, { pels: 2, mm: 1 })], [0, 0, 1, 1])
  // One black pixel in six is an average of white: sampling the middle pixel alone would make it black.
  assert.deepEqual([...toPels(new Uint8Array([255, 255, 255, 0, 255, 255]), 6, 1, { cols: 1, left: 0, lines: 1 }, { pels: 1, mm: 1 })], [0])
  assert.deepEqual([...toPels(new Uint8Array([0, 255, 0, 255, 0, 255]), 6, 1, { cols: 3, left: 0, lines: 1 }, { pels: 3, mm: 1 })], [0, 0, 0])
})

test('the fewest and the most data bits of a 1728-pel line are 16 and 7784', () => {
  assert.equal(fewestLineBits(1728, LENGTHS), 16)
  assert.equal(mostLineBits(1728, LENGTHS), 7784)
  // 16 is a white run of 1725 and a black run of 3.
  assert.equal((W.makeUp[1664 / 64 - 1] + W.terminating[61] + B.terminating[3]).length, 16)
})

test('a blank US Letter page at every rate and minimum scan line time, worked out here on its own', () => {
  const lines = 1071
  const blank = 17
  const page = codeBitmap({ width: 2550, height: 3300, pixels: new Uint8Array(2550 * 3300), dpi: { x: 300, y: 300 } })
  for (const r of RATES) {
    for (const t of SCAN_TIMES) {
      if (r.ecm && t.ms !== 0) continue
      const least = Math.ceil((r.bps * t.ms) / 1000)
      const coded = 12 + lines * (blank + 12) + 5 * 12
      const fillBits = lines * Math.max(0, least - blank - 12)
      const got = timePage(page, { bps: r.bps, ms: t.ms })
      assert.deepEqual([got.lines, got.coded, got.fill, got.bits], [lines, coded, fillBits, coded + fillBits], `${r.bps} ${t.ms}`)
      assert.ok(Math.abs(got.seconds - (coded + fillBits) / r.bps) < 1e-12)
    }
  }
})

test('the figures of the tool for a blank page: 1071 lines, 31,131 coded and 277,389 fill bits, 21.4 s', async () => {
  const t = await faxTime({ width: 2550, height: 3300, pixels: new Uint8Array(2550 * 3300), dpi: { x: 300, y: 300 } })
  const p = t.pages[0]
  assert.deepEqual([p.lines, p.coded, p.fill, p.bits], [1071, 31131, 277389, 308520])
  assert.equal(p.seconds.toFixed(1), '21.4')
  assert.equal(t.seconds, p.seconds)
})

test('bitmaps at 300 dpi give the numbers of the tool at both resolutions', () => {
  const cases = [
    ['blank Letter', 2550, 3300, 0, { standard: [1071, 31131, 277389], fine: [2142, 62190, 554778] }],
    ['blank A4', 2480, 3508, 0, { standard: [1143, 33219, 296037], fine: [2287, 66395, 592333] }],
    ['black A4', 2480, 3508, 1, { standard: [1143, 57222, 272034], fine: [2287, 114422, 544306] }],
  ]
  for (const [name, w, h, ink, want] of cases) {
    const page = codeBitmap({ width: w, height: h, pixels: new Uint8Array(w * h).fill(ink), dpi: { x: 300, y: 300 } })
    for (const resolution of ['standard', 'fine']) {
      const got = timePage(page, { resolution })
      assert.deepEqual([got.lines, got.coded, got.fill], want[resolution], `${name} ${resolution}`)
    }
  }
})

test('a bitmap with no resolution is the full width of the line with square pixels, as the tool takes it', () => {
  const w = 1728
  const h = 1100
  const pixels = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) if (y % 7 < 2) pixels.fill(1, y * w, (y + 1) * w)
  const page = codeBitmap({ width: w, height: h, pixels })
  assert.equal(page.assumed, true)
  assert.deepEqual([timePage(page).lines, timePage(page).coded, timePage(page).fill], [527, 17483, 134365])
  assert.deepEqual([timePage(page, { resolution: 'fine' }).lines, timePage(page, { resolution: 'fine' }).coded], [1054, 34838])
})

// The fax pages of test/fixtures, coded pixel for pixel. The numbers are written out here as well as in
// expected.json, so a fixture made again cannot move them unseen.
const GOLDEN = {
  'g3-standard.tif': { resolution: 'standard', pages: [[1100, 63786, 253086]] },
  'g3-2d-standard.tif': { resolution: 'standard', pages: [[1100, 63786, 253086]] },
  'g4-fine.tif': { resolution: 'fine', pages: [[2200, 132091, 501581]] },
  'g4-3-pages.tif': {
    resolution: 'standard',
    pages: [
      [1100, 64128, 252744],
      [1100, 62081, 254791],
      [1100, 64452, 252420],
    ],
    also: {
      bps: 4800,
      ms: 10,
      pages: [
        [1100, 64128, 11959],
        [1100, 62081, 12154],
        [1100, 64452, 11618],
      ],
    },
  },
}

test('fax TIFFs give the lines, coded bits and fill bits of the tool, page by page', async () => {
  assert.deepEqual(Object.keys(GOLDEN).sort(), Object.keys(EXPECTED.golden).sort())
  for (const [file, want] of Object.entries(GOLDEN)) {
    const coded = await codeTiff(fixture(file))
    assert.equal(coded.failed, null, file)
    const at = (bps, ms) => coded.pages.map((p) => timePage(p, { resolution: want.resolution, bps, ms })).map((p) => [p.lines, p.coded, p.fill])
    assert.deepEqual(at(14400, 20), want.pages, file)
    assert.deepEqual(
      at(14400, 20),
      EXPECTED.golden[file].pages.map((p) => [p.lines, p.coded, p.fill]),
      `${file} against make-fixtures.py`,
    )
    if (want.also) assert.deepEqual(at(want.also.bps, want.also.ms), want.also.pages, `${file} at ${want.also.bps}`)
  }
})

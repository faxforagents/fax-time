// The resampler: the same pels as a direct area average, with work in proportion to pixels plus pels.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { codeBitmap, LINE, place, TOLERANCE, toPels } from '../dist/index.js'

/** The area average done the direct way, every source row drawn across for every scan line it falls in. */
function reference(grey, width, height, p, line) {
  const out = new Uint8Array(p.lines * line.pels)
  const sx = width / p.cols
  const sy = height / p.lines
  for (let y = 0; y < p.lines; y++) {
    const acc = new Float64Array(p.cols)
    for (let j = Math.floor(y * sy); j < Math.min(height, Math.ceil((y + 1) * sy)); j++) {
      const wy = (Math.min((y + 1) * sy, j + 1) - Math.max(y * sy, j)) / sy
      if (!(wy > 0)) continue
      for (let x = 0; x < p.cols; x++) {
        let v = 0
        for (let i = Math.floor(x * sx); i < Math.min(width, Math.ceil((x + 1) * sx)); i++) {
          v += grey[j * width + i] * (Math.min((x + 1) * sx, i + 1) - Math.max(x * sx, i))
        }
        acc[x] += (v / sx) * wy
      }
    }
    for (let x = 0; x < p.cols; x++) if (acc[x] < 127.5 - 1e-6) out[y * line.pels + p.left + x] = 1
  }
  return out
}

/** A small seeded generator, so a failure can be run again. */
function random(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

test('toPels gives the pels of the direct area average, up and down, pixel for pixel and in between', () => {
  const rnd = random(20261119)
  const line = { pels: 64, mm: 10 }
  for (let k = 0; k < 300; k++) {
    const width = 1 + Math.floor(rnd() * 90)
    const height = 1 + Math.floor(rnd() * 90)
    const grey = new Uint8Array(width * height)
    // Mostly black and white, with some grey, so ties and near ties come up.
    for (let i = 0; i < grey.length; i++) grey[i] = rnd() < 0.2 ? Math.floor(rnd() * 256) : rnd() < 0.5 ? 0 : 255
    const cols = k % 7 === 0 ? Math.min(width, line.pels) : 1 + Math.floor(rnd() * line.pels)
    const lines = k % 7 === 0 ? height : 1 + Math.floor(rnd() * 120)
    const p = { cols, left: Math.floor((line.pels - cols) / 2), lines }
    assert.deepEqual(toPels(grey, width, height, p, line), reference(grey, width, height, p, line), `case ${k}: ${width}x${height} to ${cols}x${lines}`)
  }
})

test('a narrow page with many rows to a line costs its pixels, not its pixels times the line', () => {
  // One pixel wide and 2^20 rows high, at 0.1 by 2^20 per inch: 254 mm wide, so scaled to the whole 1728 pels of
  // the line, and one inch high. Drawing every row across the line would be 2^20 times 1728 steps.
  const height = 2 ** 20
  const started = performance.now()
  const page = codeBitmap({ width: 1, height, pixels: new Uint8Array(height).fill(1), dpi: { x: 0.1, y: height } })
  const ms = performance.now() - started
  assert.equal(page.standard.length, Math.round(25.4 * (215 / 254) * 3.85))
  assert.ok(ms < 5000, `took ${Math.round(ms)} ms`)
})

test('a resolution too small to give a size refuses the page and places no empty one', () => {
  assert.throws(() => codeBitmap({ width: 1, height: 1, pixels: new Uint8Array(1), dpi: { x: Number.MIN_VALUE, y: Number.MIN_VALUE } }), { kind: 'no-size' })
  assert.throws(() => place(Number.POSITIVE_INFINITY, 10, 3.85, LINE, TOLERANCE), RangeError)
  // Own pixels that are not whole numbers are not kept: the placement stays in whole pels and lines.
  const p = place(215, 1, 3.85, LINE, TOLERANCE, { width: 1727.5, height: 3.5 })
  assert.deepEqual(p, { cols: 1728, left: 0, lines: 4 })
})

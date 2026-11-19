// TIFF pages built here byte by byte: fax polarity, grey and colour, tags that cannot be read, and the budgets.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deflateSync } from 'node:zlib'
import { decoder } from '../dist/ccitt.js'
import { CODES, codeTiff, DECODE, encodeLine, timePage } from '../dist/index.js'
import { decodePage, openTiff } from '../dist/tiff.js'
import { concat, fixture, tiff, tiffWithStrip } from './helpers.mjs'

const D = decoder({ ...CODES, extended: DECODE.extended, modes: DECODE.modes })

async function grey(bytes) {
  const f = openTiff(bytes, 10)
  try {
    return await decodePage(bytes, f.result.pages[0], f.ifds[0], f.little, { maxPixels: 2 ** 26, decoder: D })
  } catch (err) {
    return { error: err.kind, detail: err.detail }
  }
}

/** Modified Huffman lines with no EOL, each starting on a byte: TIFF compression 2, from rows of 1 for black. */
function mhRle(rows, width) {
  const parts = rows.map((row) => {
    const bits = encodeLine(row, width, CODES)
    const out = new Uint8Array(Math.ceil(bits.length / 8))
    for (let i = 0; i < bits.length; i++) if (bits[i] === '1') out[i >> 3] |= 0x80 >> (i & 7)
    return out
  })
  return concat(...parts)
}

test('a fax-coded page with WhiteIsZero, the usual fax polarity, is black where its runs are black', async () => {
  const width = 64
  const rows = Array.from({ length: 8 }, (_, y) => Uint8Array.from({ length: width }, (_, x) => ((x >> 3) + y) & 1))
  const strip = mhRle(rows, width)
  const white = await grey(tiffWithStrip(width, 8, { 258: [3, [1]], 259: [3, [2]], 262: [3, [0]] }, strip))
  assert.deepEqual(
    [...white.grey],
    rows.flatMap((r) => [...r].map((v) => (v ? 0 : 255))),
  )
  // BlackIsZero turns the same coded runs the other way, as libtiff reads them.
  const black = await grey(tiffWithStrip(width, 8, { 258: [3, [1]], 259: [3, [2]], 262: [3, [1]] }, strip))
  assert.deepEqual(
    [...black.grey],
    rows.flatMap((r) => [...r].map((v) => (v ? 255 : 0))),
  )
})

test('8-bit grey and colour pages: polarity, BT.601 luma, alpha over white and the horizontal predictor', async () => {
  const g = await grey(tiffWithStrip(4, 1, { 258: [3, [8]], 259: [3, [1]], 262: [3, [1]] }, new Uint8Array([0, 100, 200, 255])))
  assert.deepEqual([...g.grey], [0, 100, 200, 255])
  const inverted = await grey(tiffWithStrip(4, 1, { 258: [3, [8]], 259: [3, [1]], 262: [3, [0]] }, new Uint8Array([0, 100, 200, 255])))
  assert.deepEqual([...inverted.grey], [255, 155, 55, 0])
  const rgb = await grey(tiffWithStrip(2, 1, { 258: [3, [8, 8, 8]], 259: [3, [1]], 262: [3, [2]], 277: [3, [3]] }, new Uint8Array([255, 0, 0, 0, 0, 255])))
  assert.deepEqual([...rgb.grey], [Math.round(0.299 * 255), Math.round(0.114 * 255)])
  // Unassociated alpha (ExtraSamples 2): a black pixel at half alpha over white paper is mid-grey.
  // Associated alpha (ExtraSamples 1) with WhiteIsZero: ink 170 premultiplied by alpha 170/255 is black at
  // two thirds over white paper, so grey 85.
  const inked = await grey(tiffWithStrip(1, 1, { 258: [3, [8, 8]], 259: [3, [1]], 262: [3, [0]], 277: [3, [2]], 338: [3, [1]] }, new Uint8Array([170, 170])))
  assert.deepEqual([...inked.grey], [85])
  const lit = await grey(tiffWithStrip(1, 1, { 258: [3, [8, 8]], 259: [3, [1]], 262: [3, [1]], 277: [3, [2]], 338: [3, [1]] }, new Uint8Array([0, 170])))
  assert.deepEqual([...lit.grey], [85])
  const rgba = await grey(
    tiffWithStrip(1, 1, { 258: [3, [8, 8, 8, 8]], 259: [3, [1]], 262: [3, [2]], 277: [3, [4]], 338: [3, [2]] }, new Uint8Array([0, 0, 0, 128])),
  )
  assert.deepEqual([...rgba.grey], [Math.round(255 * (1 - 128 / 255))])
  // Predictor 2 stores each sample as the difference from the one before it.
  const predicted = await grey(tiffWithStrip(4, 1, { 258: [3, [8]], 259: [3, [1]], 262: [3, [1]], 317: [3, [2]] }, new Uint8Array([10, 10, 10, 246])))
  assert.deepEqual([...predicted.grey], [10, 20, 30, 20])
  // A Deflate strip of colour, through zlib: exactly its rows, one row too few, and data that is not Deflate.
  const pixels = new Uint8Array([10, 20, 30, 40, 50, 60])
  const zip = (data) => tiffWithStrip(2, 1, { 258: [3, [8, 8, 8]], 259: [3, [8]], 262: [3, [2]], 277: [3, [3]] }, data)
  assert.equal((await grey(zip(deflateSync(pixels)))).grey.length, 2)
  assert.equal((await grey(zip(deflateSync(pixels.subarray(0, 3))))).error, 'damaged')
  assert.equal((await grey(zip(new Uint8Array([1, 2, 3, 4])))).error, 'damaged')
})

test('a tag that changes the pixels and cannot be read refuses the page, and signed types are read', async () => {
  const pixels = new Uint8Array([0, 100, 200, 255])
  // PhotometricInterpretation as UNDEFINED (type 7): not a type the reader takes.
  const undefinedType = await grey(tiffWithStrip(4, 1, { 258: [3, [8]], 259: [3, [1]], 262: [7, [1]] }, pixels))
  assert.deepEqual([undefinedType.error, undefinedType.detail], ['damaged', 'tag 262 cannot be read'])
  // The same tag as SSHORT (type 8), which libtiff takes, reads as the SHORT would.
  const signed = await grey(tiffWithStrip(4, 1, { 258: [3, [8]], 259: [3, [1]], 262: [8, [1]] }, pixels))
  assert.deepEqual([...signed.grey], [0, 100, 200, 255])
  const predictor = await grey(tiffWithStrip(4, 1, { 258: [3, [8]], 259: [3, [1]], 262: [3, [1]], 317: [7, [2]] }, pixels))
  assert.equal(predictor.error, 'damaged')
})

test('a RowsPerStrip below 1, such as -1 as SLONG or SSHORT, reads the page as one strip', async () => {
  const pixels = new Uint8Array([0, 100, 200, 255, 10, 20, 30, 40])
  const tags = { 258: [3, [8]], 259: [3, [1]], 262: [3, [1]] }
  const plain = await grey(tiffWithStrip(4, 2, tags, pixels))
  assert.deepEqual([...plain.grey], [...pixels])
  // tiffWithStrip writes -1 as its bit pattern, 0xFFFF or 0xFFFFFFFF, which the signed types read back as -1.
  for (const [type, value] of [
    [9, -1],
    [8, -1],
    [4, 0],
  ]) {
    const page = await grey(tiffWithStrip(4, 2, { ...tags, 278: [type, [value]] }, pixels))
    assert.deepEqual([...page.grey], [...pixels], `RowsPerStrip ${value} as type ${type}`)
  }
})

test('a resolution in no unit gives the shape of the pixels, not their size', async () => {
  const strip = new Uint8Array((1728 / 8) * 1100)
  const bytes = tiffWithStrip(1728, 1100, { 258: [3, [1]], 259: [3, [1]], 262: [3, [0]], 296: [3, [1]] }, strip)
  // tiffWithStrip writes no RATIONAL, so the resolution goes in as whole numbers: 204 across and 98 down.
  const withRes = tiffWithStrip(1728, 1100, { 258: [3, [1]], 259: [3, [1]], 262: [3, [0]], 282: [3, [204]], 283: [3, [98]], 296: [3, [1]] }, strip)
  const square = await codeTiff(bytes)
  assert.deepEqual([square.pages[0].assumed, square.pages[0].standard.length], [true, 527])
  const shaped = await codeTiff(withRes)
  // 215 mm wide and 1100 rows of pixels 204/98 times as tall as wide: within 1% of 1100 lines, so kept.
  assert.deepEqual([shaped.pages[0].assumed, shaped.pages[0].standard.length], [true, 1100])
})

test('pages that share one strip are each read, the strip counted once against the file', async () => {
  const page = fixture('g4-fine.tif')
  const f = openTiff(page, 1)
  // A chain of 4 IFDs that all point at the strip of one fine page, 1728 by 2200, as a writer may store
  // identical pages.
  const view = new DataView(page.buffer, page.byteOffset, page.byteLength)
  const n = view.getUint16(f.ifds[0], true)
  const ifd = page.slice(f.ifds[0], f.ifds[0] + 2 + n * 12 + 4)
  const copies = 3
  const out = new Uint8Array(page.length + copies * ifd.length)
  out.set(page, 0)
  const o = new DataView(out.buffer)
  let prev = f.ifds[0] + 2 + n * 12
  for (let k = 0; k < copies; k++) {
    const at = page.length + k * ifd.length
    out.set(ifd, at)
    o.setUint32(prev, at, true)
    prev = at + 2 + n * 12
    o.setUint32(prev, 0, true)
  }
  const coded = await codeTiff(out)
  assert.deepEqual([coded.pages.length, coded.failed], [4, null])
  const bits = coded.pages.map((p) => timePage(p, { resolution: 'fine' }).bits)
  assert.deepEqual(bits, [633672, 633672, 633672, 633672])
})

test('the pages of a file share one pixel budget', async () => {
  // Five 100 by 100 grey pages, each over a strip of its own size, with a budget of two pages.
  const small = tiff(
    Array.from({ length: 5 }, () => [
      [256, 3, [100]],
      [257, 3, [100]],
      [258, 3, [8]],
      [259, 3, [1]],
      [262, 3, [1]],
      [273, 4, [0]],
      [279, 4, [10000]],
    ]),
  )
  const capped = await codeTiff(concat(small, new Uint8Array(10000 * 5)), { limits: { maxFilePixels: 100 * 100 * 2 } })
  assert.deepEqual([capped.pages.length, capped.failed?.page, capped.failed?.kind], [2, 3, 'too-large'])
  assert.match(capped.failed?.detail ?? '', /more pixels together/)
})

/**
 * A 1024 by 1024 grey page in LSB fill order, of 1024 one-row strips into one 1 MiB span: strip i starts `step(i)`
 * bytes into the span and runs `len` bytes.
 */
function sharedSpan(step, len) {
  const span = new Uint8Array(1 << 20)
  const head = tiffWithStrip(1024, 1024, { 258: [3, [8]], 259: [3, [1]], 262: [3, [1]], 266: [3, [2]], 278: [4, [1]] }, new Uint8Array(0))
  // Rewrite StripOffsets and StripByteCounts as 1024 entries each, all pointing at the span.
  const offsets = new Uint8Array(4 * 1024)
  const counts = new Uint8Array(4 * 1024)
  const file = concat(head, offsets, counts, span)
  const v = new DataView(file.buffer)
  const spanAt = head.length + offsets.length + counts.length
  for (let i = 0; i < 1024; i++) {
    v.setUint32(head.length + 4 * i, spanAt + step(i), true)
    v.setUint32(head.length + offsets.length + 4 * i, len, true)
  }
  const n = v.getUint16(8, true)
  for (let k = 0; k < n; k++) {
    const e = 8 + 2 + k * 12
    const tag = v.getUint16(e, true)
    if (tag === 273 || tag === 279) {
      v.setUint32(e + 4, 1024, true)
      v.setUint32(e + 8, tag === 273 ? head.length : head.length + offsets.length, true)
    }
  }
  return file
}

test('strips that add up to more than the file, or hold no bytes, are refused before they are read', async () => {
  // The same 1 MiB named by all 1024 strips is counted and turned round once, not 1024 times.
  let started = performance.now()
  const same = await codeTiff(sharedSpan(() => 0, 1 << 20))
  assert.deepEqual([same.failed, same.pages.length], [null, 1])
  assert.ok(performance.now() - started < 2000)
  // 1024 strips that overlap but are not the same come to 1 GiB, far past the file: refused.
  started = performance.now()
  const overlapping = await codeTiff(sharedSpan((i) => i, (1 << 20) - 1024))
  assert.equal(overlapping.failed?.kind, 'strips')
  assert.ok(performance.now() - started < 2000)
  const empty = await grey(tiffWithStrip(4, 1, { 258: [3, [8]], 259: [3, [1]], 262: [3, [1]] }, new Uint8Array(0)))
  assert.equal(empty.error, 'damaged')
})

test('a page made of the bits the coder counts keeps its numbers through a TIFF', async () => {
  const width = 1728
  const rows = Array.from({ length: 98 }, (_, y) => Uint8Array.from({ length: width }, (_, x) => (x > 100 + y && x < 900 ? 1 : 0)))
  const bytes = tiffWithStrip(width, 98, { 258: [3, [1]], 259: [3, [2]], 262: [3, [0]], 282: [3, [204]], 283: [3, [98]] }, mhRle(rows, width))
  const { pages } = await codeTiff(bytes)
  const t = timePage(pages[0])
  const data = rows.reduce((n, r) => n + encodeLine(r, width, CODES).length, 0)
  assert.equal(t.lines, 98)
  assert.equal(t.coded, 12 + data + 98 * 12 + 5 * 12)
})

test('a resolution in centimetres is the same density as in inches, so a fax page is still coded row for row', async () => {
  const bytes = fixture('fax-200x100.tif').slice()
  const f = openTiff(bytes, 1)
  const v = new DataView(bytes.buffer)
  const n = v.getUint16(f.ifds[0], true)
  for (let k = 0; k < n; k++) {
    const e = f.ifds[0] + 2 + k * 12
    const tag = v.getUint16(e, true)
    if (tag === 296) v.setUint16(e + 8, 3, true)
    if (tag === 282 || tag === 283) {
      // 10000/127 and 5000/127 per centimetre are 200 and 100 per inch exactly.
      const at = v.getUint32(e + 8, true)
      v.setUint32(at, tag === 282 ? 10000 : 5000, true)
      v.setUint32(at + 4, 127, true)
    }
  }
  const { pages } = await codeTiff(bytes)
  assert.deepEqual([pages[0].standard.length, pages[0].fine.length], [1100, 2200])
  assert.equal(timePage(pages[0]).seconds, timePage((await codeTiff(fixture('fax-200x100.tif'))).pages[0]).seconds)
})

test('a Group 4 strip in the uncompressed mode its options allow is named as a mode the reader does not read', async () => {
  const bytes = tiffWithStrip(2, 1, { 258: [3, [1]], 259: [3, [4]], 262: [3, [0]], 293: [4, [2]] }, new Uint8Array([0x03, 0xf0, 0x20, 0x01, 0x00, 0x10]))
  const r = await grey(bytes)
  assert.deepEqual([r.error, r.detail], ['compression', 'the uncompressed mode of fax coding'])
})

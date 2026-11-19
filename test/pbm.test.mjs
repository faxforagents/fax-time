// The PBM reader: raw and plain PBM, several images, comments, and headers that ask for more than the file holds.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decoder } from '../dist/ccitt.js'
import { CODES, codePbm, codeTiff, DECODE, eachPbm, faxTime, PbmReadError, readPbm, timePage } from '../dist/index.js'
import { decodePage, openTiff } from '../dist/tiff.js'
import { concat, fixture, pbm } from './helpers.mjs'

const text = (s) => new TextEncoder().encode(s)

test('raw PBM: rows packed eight pels to a byte, most significant first, 1 for black', () => {
  // A 10 by 2 image: the first row black at pels 0 and 9, the second all black.
  const bytes = concat(text('P4\n10 2\n'), new Uint8Array([0b10000000, 0b01000000, 0xff, 0xff]))
  const { images, more, stopped } = readPbm(bytes, 10, 1000)
  assert.deepEqual([images.length, more, stopped], [1, false, null])
  assert.deepEqual([...images[0].pixels], [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
})

test('plain PBM: one character a pel, white space and comments between them', () => {
  const bytes = text('P1\n# feep\n4 2\n1 0 0 1\n0110 # a comment in the raster\n junk after the raster')
  const { images } = readPbm(bytes, 10, 1000)
  assert.deepEqual([images[0].width, images[0].height, [...images[0].pixels]], [4, 2, [1, 0, 0, 1, 0, 1, 1, 0]])
})

test('several raw images in one file are several pages, and the limit counts them', () => {
  const one = pbm(8, 1, [1, 1, 1, 1, 0, 0, 0, 0])
  const three = concat(one, one, one, text('\n'))
  assert.equal(readPbm(three, 10, 1000).images.length, 3)
  const capped = readPbm(three, 2, 1000)
  assert.deepEqual([capped.images.length, capped.more], [2, true])
})

test('a header that asks for more than the file holds asks for nothing', () => {
  assert.throws(() => readPbm(text('P6\n1 1\n255\n\0\0\0'), 10, 1000), PbmReadError)
  const huge = readPbm(text('P4\n100000 100000\n\0'), 10, 2 ** 26)
  assert.deepEqual([huge.images.length, huge.stopped?.kind], [0, 'too-large'])
  const short = readPbm(text('P4\n1000 1000\n\0\0\0'), 10, 2 ** 26)
  assert.deepEqual([short.images.length, short.stopped?.kind], [0, 'damaged'])
  const plainShort = readPbm(text('P1 1000 1000\n0 1'), 10, 2 ** 26)
  assert.equal(plainShort.stopped?.kind, 'damaged')
  assert.equal(readPbm(text('P1 2 1\n0 2'), 10, 1000).stopped?.kind, 'damaged')
  assert.equal(readPbm(text('P4 0 5\n'), 10, 1000).stopped?.kind, 'damaged')
  assert.equal(readPbm(text('P4 12345678901 5\n'), 10, 1000).stopped?.kind, 'too-large')
  assert.equal(readPbm(text('P42 2\n'), 10, 1000).stopped?.kind, 'damaged')
  // Good pages before a cut one are kept.
  const cut = concat(pbm(8, 1, new Array(8).fill(1)), text('P4\n8 4\n\0'))
  const r = codePbm(cut)
  assert.deepEqual([r.pages.length, r.failed?.page, r.failed?.kind], [1, 2, 'damaged'])
})

test('a fax page as a PBM at 204 by 98 gives the numbers of the same page as a TIFF', async () => {
  const bytes = fixture('g3-standard.tif')
  const f = openTiff(bytes, 1)
  const d = decoder({ ...CODES, extended: DECODE.extended, modes: DECODE.modes })
  const g = await decodePage(bytes, f.result.pages[0], f.ifds[0], f.little, { maxPixels: 2 ** 26, decoder: d })
  const file = pbm(
    g.width,
    g.height,
    g.grey.map((v) => (v === 0 ? 1 : 0)),
  )
  const fromTiff = timePage((await codeTiff(bytes)).pages[0])
  const fromPbm = await faxTime(file, { dpi: { x: 204, y: 98 } })
  assert.deepEqual([fromPbm.pages[0].lines, fromPbm.pages[0].coded, fromPbm.pages[0].fill], [1100, 63786, 253086])
  assert.deepEqual({ ...fromPbm.pages[0] }, { ...fromTiff })
  // Without a resolution the pixels are square and the page the full width of the line.
  const square = await faxTime(file)
  assert.deepEqual([square.pages[0].assumed, square.pages[0].lines], [true, 527])
})

test('a comment may end the header, CRLF line ends work, and leading zeros say nothing', () => {
  for (const header of ['P4\n8 1#made by hand\n', 'P4\r\n8 1\r\n'.slice(0, -1), 'P4 # a\n # b\n8 1#c\r']) {
    const r = readPbm(concat(text(header), new Uint8Array([0xf0])), 10, 1000)
    assert.deepEqual([r.stopped, [...r.images[0].pixels]], [null, [1, 1, 1, 1, 0, 0, 0, 0]], JSON.stringify(header))
  }
  const plainComment = readPbm(text('P1\n2 1#c\n1 0'), 10, 1000)
  assert.deepEqual([...plainComment.images[0].pixels], [1, 0])
  const zeros = readPbm(concat(text('P4\n0000000008 1\n'), new Uint8Array([0xff])), 10, 1000)
  assert.deepEqual([zeros.stopped, zeros.images[0].width], [null, 8])
})

test('raw and plain images can follow each other, and junk after the last raw one is named', () => {
  const raw = pbm(8, 1, [1, 0, 1, 0, 1, 0, 1, 0])
  const mixed = concat(raw, text('P1\n2 1\n0 1\n'), raw)
  assert.deepEqual(
    readPbm(mixed, 10, 1000).images.map((i) => [...i.pixels]),
    [
      [1, 0, 1, 0, 1, 0, 1, 0],
      [0, 1],
      [1, 0, 1, 0, 1, 0, 1, 0],
    ],
  )
  // Anything after a plain image that is not another image is the junk the format allows there.
  assert.equal(readPbm(text('P1 1 1 1 and then some words'), 10, 1000).stopped, null)
  const junk = readPbm(concat(raw, text('junk')), 10, 1000)
  assert.deepEqual([junk.images.length, junk.stopped?.kind], [1, 'not-pbm'])
})

test('the images of a PBM file share the pixel budget, checked before an image is read', () => {
  const image = pbm(8, 8, new Array(64).fill(1))
  const file = concat(image, image, image)
  const r = codePbm(file, { limits: { maxFilePixels: 128 } })
  assert.deepEqual([r.pages.length, r.failed?.page, r.failed?.kind], [2, 3, 'too-large'])
  assert.match(r.failed?.detail ?? '', /more pixels together/)
  // Read one at a time: the generator gives the first image before it looks at the second.
  const it = eachPbm(concat(image, text('P4\n8 8\n')), 10, 1000)
  assert.equal(it.next().value.width, 8)
  assert.equal(it.next().value.stopped?.kind, 'damaged')
})

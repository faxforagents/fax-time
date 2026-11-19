// Shared by the tests: the built package, the fixtures and small files built here byte by byte.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const FIXTURES = join(ROOT, 'test', 'fixtures')
export const fixture = (name) => new Uint8Array(readFileSync(join(FIXTURES, name)))
export const EXPECTED = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8'))
export const DATA = JSON.parse(readFileSync(join(ROOT, 'src', 'standards.json'), 'utf8'))

/** A 1728-pel line from its runs, white first: 1 for black. */
export function line(runs, pels = 1728) {
  const row = new Uint8Array(pels)
  let x = 0
  runs.forEach((n, i) => {
    if (i % 2) row.fill(1, x, x + n)
    x += n
  })
  if (x !== pels) throw new Error(`a test line of ${x} pels`)
  return row
}

/** A TIFF with one IFD per entry of `ifds`, each a list of [tag, type, values]. Types: 3 SHORT, 4 LONG, 5 RATIONAL. */
export function tiff(ifds, { order = 'II', magic = 42, next = null } = {}) {
  const little = order === 'II'
  const size = { 3: 2, 4: 4, 5: 8 }
  // Lay out: header, then each IFD followed by its out-of-line values.
  let at = 8
  const layout = ifds.map((entries) => {
    const start = at
    at += 2 + entries.length * 12 + 4
    const extra = entries.map(([, type, values]) => {
      const bytes = size[type] * values.length
      if (bytes <= 4) return null
      const where = at
      at += bytes
      return where
    })
    return { start, extra }
  })
  const buf = new DataView(new ArrayBuffer(at))
  const u16 = (p, v) => buf.setUint16(p, v, little)
  const u32 = (p, v) => buf.setUint32(p, v, little)
  buf.setUint8(0, order.charCodeAt(0))
  buf.setUint8(1, order.charCodeAt(1))
  u16(2, magic)
  u32(4, ifds.length ? 8 : 0)
  ifds.forEach((entries, i) => {
    const { start, extra } = layout[i]
    u16(start, entries.length)
    entries.forEach(([tag, type, values], k) => {
      const e = start + 2 + k * 12
      u16(e, tag)
      u16(e + 2, type)
      u32(e + 4, values.length)
      const put = (p, v) => {
        if (type === 3) u16(p, v)
        else if (type === 4) u32(p, v)
        else {
          u32(p, v[0])
          u32(p + 4, v[1])
        }
      }
      const base = extra[k] ?? e + 8
      for (const [j, v] of values.entries()) put(base + j * size[type], v)
      if (extra[k] !== null) u32(e + 8, extra[k])
    })
    const nextAt = start + 2 + entries.length * 12
    u32(nextAt, i + 1 < ifds.length ? layout[i + 1].start : (next ?? 0))
  })
  return new Uint8Array(buf.buffer)
}

/** The tags of a fax-like page with no image data. */
export const fax = (extra = []) => [
  [256, 3, [1728]],
  [257, 4, [2200]],
  [258, 3, [1]],
  [259, 3, [3]],
  [262, 3, [0]],
  [266, 3, [2]],
  [282, 5, [[204, 1]]],
  [283, 5, [[196, 1]]],
  [292, 4, [0]],
  [296, 3, [2]],
  ...extra,
]

/**
 * A one-page little-endian TIFF with one strip: `tags` maps a tag to [type, values], 3 SHORT and 4 LONG. Width,
 * height, RowsPerStrip, StripOffsets and StripByteCounts are filled in.
 */
export function tiffWithStrip(width, height, tags, strip) {
  const entries = new Map([
    [256, [4, [width]]],
    [257, [4, [height]]],
    [278, [4, [height]]],
    ...Object.entries(tags).map(([k, v]) => [Number(k), v]),
    [273, [4, [0]]],
    [279, [4, [strip.length]]],
  ])
  const sorted = [...entries.entries()].sort((a, b) => a[0] - b[0])
  const count = sorted.length
  const ifd = 8
  const dataAt = ifd + 2 + count * 12 + 4
  const extra = []
  let extraLength = 0
  const head = new DataView(new ArrayBuffer(dataAt))
  head.setUint8(0, 0x49)
  head.setUint8(1, 0x49)
  head.setUint16(2, 42, true)
  head.setUint32(4, ifd, true)
  head.setUint16(ifd, count, true)
  let stripOffsetField = 0
  sorted.forEach(([tag, [type, values]], i) => {
    const e = ifd + 2 + i * 12
    head.setUint16(e, tag, true)
    head.setUint16(e + 2, type, true)
    head.setUint32(e + 4, values.length, true)
    const width = type === 3 ? 2 : 4
    const packed = new DataView(new ArrayBuffer(width * values.length))
    for (const [j, v] of values.entries()) {
      if (type === 3) packed.setUint16(j * width, v, true)
      else packed.setUint32(j * width, v, true)
    }
    if (packed.byteLength <= 4) new Uint8Array(head.buffer).set(new Uint8Array(packed.buffer), e + 8)
    else {
      head.setUint32(e + 8, dataAt + extraLength, true)
      extra.push(new Uint8Array(packed.buffer))
      extraLength += packed.byteLength
    }
    if (tag === 273) stripOffsetField = e + 8
  })
  head.setUint32(ifd + 2 + count * 12, 0, true)
  const out = new Uint8Array(dataAt + extraLength + strip.length)
  out.set(new Uint8Array(head.buffer), 0)
  let at = dataAt
  for (const part of extra) {
    out.set(part, at)
    at += part.length
  }
  out.set(strip, at)
  new DataView(out.buffer).setUint32(stripOffsetField, at, true)
  return out
}

/** A raw PBM (P4) of one image: `pixels` holds width × height bytes, 1 for black. */
export function pbm(width, height, pixels, header = `P4\n${width} ${height}\n`) {
  const rowBytes = Math.ceil(width / 8)
  const raster = new Uint8Array(rowBytes * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (pixels[y * width + x]) raster[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7)
  const head = new TextEncoder().encode(header)
  const out = new Uint8Array(head.length + raster.length)
  out.set(head, 0)
  out.set(raster, head.length)
  return out
}

export const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// The fax-time command, run as a user runs it.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { FIXTURES, pbm, ROOT } from './helpers.mjs'

const CLI = join(ROOT, 'dist', 'cli.js')
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
const dir = mkdtempSync(join(tmpdir(), 'fax-time-test-'))
// On exit, not in an after() hook: Node 20.0.0 does not run a hook at the top of a file.
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))

test('fax-time <file> prints the seconds of each page and the total', () => {
  const r = run(join(FIXTURES, 'g4-3-pages.tif'))
  assert.equal(r.status, 0, r.stderr)
  assert.equal(
    r.stdout,
    [
      'page 1: 22.0 s, 316872 bits (64128 coded, 252744 fill), 1100 lines',
      'page 2: 22.0 s, 316872 bits (62081 coded, 254791 fill), 1100 lines',
      'page 3: 22.0 s, 316872 bits (64452 coded, 252420 fill), 1100 lines',
      'total: 66.0 s for 3 pages at 14 400 bit/s, standard resolution, 20 ms minimum scan line time',
      'This covers the page data only, not the call around it.',
      '',
    ].join('\n'),
  )
  assert.equal(r.stderr, '')
})

test('the rate, the scan line time and the resolution can be picked, and JSON printed', () => {
  const r = run('--rate', '4800', '-t', '10', '--json', join(FIXTURES, 'g4-3-pages.tif'))
  assert.equal(r.status, 0, r.stderr)
  const t = JSON.parse(r.stdout)
  assert.deepEqual(t.settings, { resolution: 'standard', bps: 4800, ms: 10 })
  assert.deepEqual(
    t.pages.map((p) => [p.coded, p.fill]),
    [
      [64128, 11959],
      [62081, 12154],
      [64452, 11618],
    ],
  )
  const fine = JSON.parse(run('--fine', '--json', join(FIXTURES, 'g4-fine.tif')).stdout)
  assert.deepEqual([fine.pages[0].lines, fine.pages[0].coded, fine.pages[0].fill], [2200, 132091, 501581])
  const v34 = JSON.parse(run('-r', '33600', '--json', join(FIXTURES, 'g4-fine.tif')).stdout)
  assert.deepEqual([v34.settings.ms, v34.pages[0].fill], [0, 0])
})

test('a PBM takes --dpi, and says when it has to take the page as the width of the line', () => {
  const pixels = new Uint8Array(1728 * 1100)
  pixels.fill(1, 1728 * 200, 1728 * 400)
  const file = join(dir, 'page.pbm')
  writeFileSync(file, pbm(1728, 1100, pixels))
  const plain = run(file)
  assert.equal(plain.status, 0, plain.stderr)
  assert.match(plain.stderr, /no size on paper/)
  assert.match(plain.stdout, /^page 1: .* 527 lines$/m)
  const given = run('--dpi', '204x98', file)
  assert.equal(given.stderr, '')
  assert.match(given.stdout, /^page 1: .* 1100 lines$/m)
})

test('wrong arguments exit 2 and unreadable files exit 1', () => {
  assert.equal(run().status, 2)
  assert.equal(run('--rate', '28800', join(FIXTURES, 'g4-fine.tif')).status, 2)
  assert.equal(run('--rate', '33600', '--scan-time', '20', join(FIXTURES, 'g4-fine.tif')).status, 2)
  assert.equal(run('--dpi', 'wide', join(FIXTURES, 'g4-fine.tif')).status, 2)
  assert.equal(run('--frobnicate', join(FIXTURES, 'g4-fine.tif')).status, 2)
  const missing = run(join(dir, 'missing.tif'))
  assert.deepEqual([missing.status, /ENOENT/.test(missing.stderr)], [1, true])
  const pdf = join(dir, 'a.pdf')
  writeFileSync(pdf, '%PDF-1.7\n')
  const p = run(pdf)
  assert.deepEqual([p.status, /render it to a TIFF or PBM first/.test(p.stderr)], [1, true])
  const png = join(dir, 'a.png')
  writeFileSync(png, '\x89PNG\r\n')
  assert.equal(run(png).status, 1)
})

test('--version prints the version of package.json, and --help the usage', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(run('--version').stdout.trim(), pkg.version)
  const help = run('--help')
  assert.equal(help.status, 0)
  assert.match(help.stdout, /^Usage: fax-time \[options\] <file>/)
  assert.match(help.stdout, /page data only/)
})

test('a page that is not read, a page limit reached or a damaged page chain exit 1, and say why', () => {
  const limited = run('--max-pages', '2', join(FIXTURES, 'g4-3-pages.tif'))
  assert.deepEqual([limited.status, /only the first 2 were read/.test(limited.stderr)], [1, true])
  assert.match(limited.stdout, /^total: 44\.0 s for 2 pages/m)
  const bytes = readFileSync(join(FIXTURES, 'g4-3-pages.tif'))
  // Point the second page's strip past the end of the file.
  const cut = Buffer.from(bytes)
  const ifds = []
  for (let at = cut.readUInt32LE(4); at; at = cut.readUInt32LE(at + 2 + cut.readUInt16LE(at) * 12)) ifds.push(at)
  for (let k = 0; k < cut.readUInt16LE(ifds[1]); k++) {
    const e = ifds[1] + 2 + k * 12
    if (cut.readUInt16LE(e) === 273) cut.writeUInt32LE(cut.length + 10, e + 8)
  }
  const broken = join(dir, 'broken.tif')
  writeFileSync(broken, cut)
  const b = run(broken)
  assert.deepEqual([b.status, /page 2 could not be read/.test(b.stderr)], [1, true])
  // When a page stopped the reading, the page limit is not blamed for it.
  const both = run('--max-pages', '2', broken)
  assert.deepEqual([both.status, /page 2 could not be read/.test(both.stderr), /only the first/.test(both.stderr)], [1, true, false])
  assert.match(b.stdout, /^page 1: /m)
  // The last page's next-IFD offset pointing back at the first page.
  const looped = Buffer.from(bytes)
  looped.writeUInt32LE(ifds[0], ifds[2] + 2 + looped.readUInt16LE(ifds[2]) * 12)
  const loopFile = join(dir, 'loop.tif')
  writeFileSync(loopFile, looped)
  const l = run(loopFile)
  assert.deepEqual([l.status, /chain of pages ends early \(loop\)/.test(l.stderr)], [1, true])
})

test('--dpi 0, a clash of --fine and --resolution, and --max-pages 0 exit 2 with no stack trace', () => {
  for (const args of [
    ['--dpi', '0'],
    ['--dpi', '0x98'],
    ['--fine', '--resolution', 'standard'],
    ['--max-pages', '0'],
    ['--resolution', 'superfine'],
    ['--resolution='],
    ['--max-pages', '9'.repeat(309)],
    ['--max-pages', '9007199254740993'],
  ]) {
    const r = run(...args, join(FIXTURES, 'g4-fine.tif'))
    assert.equal(r.status, 2, args.join(' '))
    assert.ok(!/\n\s+at /.test(r.stderr), `a stack trace for ${args.join(' ')}`)
  }
  assert.match(run('--resolution', 'fine', join(FIXTURES, 'g4-fine.tif')).stdout, /2200 lines/)
  assert.equal(run('-h').status, 0)
})

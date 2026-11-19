// The fax-time command, run as a user runs it.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { FIXTURES, pbm, ROOT } from './helpers.mjs'

const CLI = join(ROOT, 'dist', 'cli.js')
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
const dir = mkdtempSync(join(tmpdir(), 'fax-time-test-'))
after(() => rmSync(dir, { recursive: true, force: true }))

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

test('a PBM takes --dpi, and says when it has to assume square pixels', () => {
  const pixels = new Uint8Array(1728 * 1100)
  pixels.fill(1, 1728 * 200, 1728 * 400)
  const file = join(dir, 'page.pbm')
  writeFileSync(file, pbm(1728, 1100, pixels))
  const plain = run(file)
  assert.equal(plain.status, 0, plain.stderr)
  assert.match(plain.stderr, /no resolution/)
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

// scripts/check-pack.mjs: a package that misses a file one of its modules imports is refused.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ROOT } from './helpers.mjs'

const dir = mkdtempSync(join(tmpdir(), 'fax-time-pack-'))
// On exit, not in an after() hook: Node 20.0.0 does not run a hook at the top of a file.
process.on('exit', () => rmSync(dir, { recursive: true, force: true }))

/** The pack listing npm would give for these files, in the shape of npm pack --json. */
function check(files) {
  const listing = join(dir, 'pack.json')
  writeFileSync(listing, JSON.stringify([{ files: files.map((path) => ({ path })) }]))
  return spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-pack.mjs'), listing], { encoding: 'utf8' })
}

test('the pack check takes the built package and refuses one with a module or a file missing, or one too many', () => {
  const all = ['README.md', 'LICENSE', 'CHANGELOG.md', 'package.json', ...readdirSync(join(ROOT, 'dist')).map((f) => `dist/${f}`)]
  assert.equal(check(all).status, 0)
  const noPage = check(all.filter((f) => f !== 'dist/page.js' && f !== 'dist/page.d.ts'))
  assert.equal(noPage.status, 1)
  assert.match(noPage.stderr, /dist\/index\.js imports \.\/page\.js/)
  assert.equal(check(all.filter((f) => f !== 'CHANGELOG.md')).status, 1)
  assert.equal(check([...all, 'test/fixtures/g4-fine.tif']).status, 1)
})

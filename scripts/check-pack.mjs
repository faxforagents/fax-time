// The package holds dist, the README, the licence, the changelog and package.json, and nothing else. The files
// the exports and the bin name are in it, and so is every file that a packed module or declaration imports.
// Run by CI and by the publish workflow, from the root of the repository after the build.
//
//   npm pack --dry-run --json > pack.json && node scripts/check-pack.mjs pack.json
import { readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [pack] = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const files = pack.files.map((f) => f.path)
const packed = new Set(files)
console.log(files.join('\n'))
const extra = files.filter((f) => !/^(dist\/[\w.-]+\.(js|d\.ts|json)|README\.md|LICENSE|CHANGELOG\.md|package\.json)$/.test(f))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const named = [
  manifest.main,
  manifest.types,
  ...Object.values(manifest.bin ?? {}),
  ...Object.values(manifest.exports).flatMap((e) => (typeof e === 'string' ? [e] : Object.values(e))),
]
const needed = [...new Set(['README.md', 'LICENSE', 'CHANGELOG.md', 'package.json', ...named.map((f) => normalize(f))])]
const missing = needed.filter((f) => !packed.has(f))
// Every relative import of a packed module or declaration must be packed too, or the package fails to load.
const broken = []
for (const f of files.filter((f) => /\.(js|d\.ts)$/.test(f))) {
  const text = readFileSync(join(root, f), 'utf8')
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = normalize(join(dirname(f), m[1]))
    // A declaration imports './x.js' for the types of './x.d.ts'.
    const candidates = f.endsWith('.d.ts') ? [target, target.replace(/\.js$/, '.d.ts')] : [target]
    if (!candidates.some((c) => packed.has(c))) broken.push(`${f} imports ${m[1]}`)
  }
}
if (extra.length) console.error('not meant to ship:', extra)
if (missing.length) console.error('missing from the package:', missing)
if (broken.length) console.error('imports that are not in the package:', broken)
if (extra.length || missing.length || broken.length) process.exit(1)
console.log(`check-pack: ${files.length} files, as meant`)

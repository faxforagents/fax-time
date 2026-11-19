// The package holds dist, the README, the licence, the changelog and package.json, and nothing else, and the
// files the exports and the bin name are all in it. Run by CI and by the publish workflow.
//
//   npm pack --dry-run --json > pack.json && node scripts/check-pack.mjs pack.json
import { readFileSync } from 'node:fs'

const [pack] = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const files = pack.files.map((f) => f.path)
console.log(files.join('\n'))
const extra = files.filter((f) => !/^(dist\/[\w.-]+\.(js|d\.ts|json)|README\.md|LICENSE|CHANGELOG\.md|package\.json)$/.test(f))
const needed = ['dist/index.js', 'dist/index.d.ts', 'dist/cli.js', 'dist/standards.json', 'README.md', 'LICENSE', 'package.json']
const missing = needed.filter((f) => !files.includes(f))
if (extra.length) console.error('not meant to ship:', extra)
if (missing.length) console.error('missing from the package:', missing)
if (extra.length || missing.length) process.exit(1)
console.log(`check-pack: ${files.length} files, as meant`)

// src/standards.json is the data of record. This script writes it into src/standards-data.ts, so the package
// loads it as a module on every Node version, with no JSON import, and copies it to dist/ for the
// faxforagents-fax-time/standards.json export.
//
//   node scripts/embed-standards.mjs           write src/standards-data.ts
//   node scripts/embed-standards.mjs --check   exit 1 when src/standards-data.ts is not the JSON
//   node scripts/embed-standards.mjs --dist    copy src/standards.json to dist/standards.json
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const json = join(root, 'src', 'standards.json')
const module = join(root, 'src', 'standards-data.ts')
const data = JSON.parse(readFileSync(json, 'utf8'))
const text = `// Generated from standards.json by scripts/embed-standards.mjs. Edit standards.json, never this file.
const data = ${JSON.stringify(data, null, 2)}

export default data
`
const mode = process.argv[2]
if (mode === '--check') {
  if (!existsSync(module) || readFileSync(module, 'utf8') !== text) {
    console.error('embed-standards: src/standards-data.ts is not src/standards.json. Run node scripts/embed-standards.mjs')
    process.exit(1)
  }
} else if (mode === '--dist') {
  mkdirSync(join(root, 'dist'), { recursive: true })
  copyFileSync(json, join(root, 'dist', 'standards.json'))
} else if (mode === undefined) {
  writeFileSync(module, text)
} else {
  console.error(`embed-standards: unknown option ${mode}`)
  process.exit(2)
}

// The package as a browser bundler sees it: dist/index.js bundled by esbuild for the browser platform, with the
// "browser" condition. It fails if any import of a Node module is left, or if Deflate is not the browser one.
// Run by CI after the build, from the root of the repository.
//
//   npm run build && node scripts/check-browser.mjs
import { build } from 'esbuild'

let result
try {
  result = await build({
    entryPoints: ['dist/index.js'],
    bundle: true,
    platform: 'browser',
    format: 'esm',
    write: false,
    metafile: true,
    logLevel: 'silent',
  })
} catch (err) {
  for (const e of err.errors ?? []) console.error(`${e.location?.file ?? ''}: ${e.text}`)
  console.error('check-browser: dist/index.js does not bundle for a browser')
  process.exit(1)
}
const inputs = result.metafile.inputs
const nodeImports = Object.entries(inputs).flatMap(([file, i]) =>
  i.imports.filter((m) => m.external || m.path.startsWith('node:')).map((m) => `${file} imports ${m.path}`),
)
const files = Object.keys(inputs)
const problems = [...nodeImports]
if (!files.includes('dist/inflate-browser.js')) problems.push('dist/inflate-browser.js is not in the bundle')
if (files.includes('dist/inflate-node.js')) problems.push('dist/inflate-node.js is in the bundle')
if (problems.length) {
  for (const p of problems) console.error(p)
  process.exit(1)
}
console.log(`check-browser: ${files.length} modules, no Node import, Deflate through DecompressionStream`)

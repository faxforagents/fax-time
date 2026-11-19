// Deflate behind `#inflate`: zlib in Node, DecompressionStream in a browser. Both must give the same rows.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deflateSync } from 'node:zlib'
import * as browser from '../dist/inflate-browser.js'
import * as node from '../dist/inflate-node.js'

const rows = Uint8Array.from({ length: 4096 }, (_, i) => (i * 7) & 0xff)

test('the browser and Node inflate give the same rows, cut where the rows end', async () => {
  for (const impl of [node, browser]) {
    assert.deepEqual([...(await impl.inflate(deflateSync(rows), rows.length))], [...rows])
    // A strip that would inflate past its rows is read only as far as they go.
    assert.deepEqual([...(await impl.inflate(deflateSync(rows), 100))], [...rows.subarray(0, 100)])
  }
})

test('a strip that ends early or is not Deflate is an InflateError in both', async () => {
  for (const impl of [node, browser]) {
    await assert.rejects(impl.inflate(deflateSync(rows.subarray(0, 10)), 100), impl.InflateError)
    await assert.rejects(impl.inflate(new Uint8Array([1, 2, 3, 4]), 100), impl.InflateError)
  }
  assert.equal(node.InflateError, browser.InflateError)
})

/**
 * Deflate in Node and every runtime that is not a browser, where package.json maps `#inflate` here. zlib refuses
 * to write more than the rows, and only a strip that would inflate past them is read again as a stream, up to
 * its rows.
 */
import { constants, inflateSync } from 'node:zlib'
import { InflateError, inflateStream } from './inflate-stream.js'

export { InflateError }

export async function inflate(data: Uint8Array, expected: number): Promise<Uint8Array> {
  let out: Uint8Array
  try {
    out = inflateSync(data, { maxOutputLength: expected, finishFlush: constants.Z_SYNC_FLUSH })
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') return inflateStream(data, expected)
    throw new InflateError('a Deflate strip could not be read')
  }
  if (out.length < expected) throw new InflateError('a Deflate strip ends early')
  return out
}

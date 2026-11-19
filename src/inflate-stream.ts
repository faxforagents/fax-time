/**
 * Deflate through the platform's DecompressionStream, read only as far as the rows need. Browsers and Node both
 * have it. ./inflate-browser.ts uses it for every strip, ./inflate-node.ts only for a strip zlib would inflate
 * past its rows.
 */

/** A Deflate strip that could not give its rows. tiff.ts names it as damaged. */
export class InflateError extends Error {}

export async function inflateStream(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const out = new Uint8Array(expected)
  let o = 0
  const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
  try {
    while (o < expected) {
      const { done, value } = await reader.read()
      if (done) break
      const take = Math.min(value.length, expected - o)
      out.set(value.subarray(0, take), o)
      o += take
    }
  } catch {
    throw new InflateError('a Deflate strip could not be read')
  } finally {
    reader.cancel().catch(() => {})
  }
  if (o < expected) throw new InflateError('a Deflate strip ends early')
  return out
}

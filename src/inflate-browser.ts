/**
 * Deflate in a browser, where package.json maps `#inflate` here: DecompressionStream for every strip, so the
 * package imports no Node module and a bundler needs no stand-in for node:zlib.
 */
export { InflateError, inflateStream as inflate } from './inflate-stream.js'

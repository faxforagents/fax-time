// The code tables of T.4 and the encoder, against code words copied here by hand from the text.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CODES, encodeLine, LENGTHS, lineBits, runCode, runs } from '../dist/index.js'
import { DATA, line } from './helpers.mjs'

// Code words copied by hand from T.4 (07/03), Tables 2 and 3a (pages 5 to 7 of the PDF), and the EOL of 4.1.2.
const T4_WHITE = {
  0: '00110101',
  1: '000111',
  2: '0111',
  13: '000011',
  48: '00001011',
  51: '01010100',
  63: '00110100',
  64: '11011',
  128: '10010',
  1664: '011000',
  1728: '010011011',
}
const T4_BLACK = {
  0: '0000110111',
  1: '010',
  2: '11',
  13: '00000100',
  48: '000001100100',
  63: '000001100111',
  64: '0000001111',
  128: '000011001000',
  1664: '0000001100100',
  1728: '0000001100101',
}
const T4_EOL = '000000000001'

/** The code words of one run from the hand-copied words: the make-up of the largest multiple of 64, then the rest. */
const handCode = (run, colour) => {
  const table = colour === 0 ? T4_WHITE : T4_BLACK
  return run < 64 ? table[run] : table[Math.floor(run / 64) * 64] + table[run % 64]
}

test('the code tables are whole and a prefix code', () => {
  for (const colour of ['white', 'black']) {
    const table = CODES[colour]
    assert.equal(table.terminating.length, 64, colour)
    assert.equal(table.makeUp.length, 1728 / 64, colour)
    const words = [...table.terminating, ...table.makeUp, CODES.eol]
    assert.ok(
      words.every((w) => /^[01]{2,13}$/.test(w)),
      colour,
    )
    assert.equal(new Set(words).size, words.length, `${colour} repeats a code word`)
    for (const a of words) for (const b of words) assert.ok(a === b || !b.startsWith(a), `${colour}: ${a} starts ${b}`)
    // A prefix code fits in the code space (Kraft's inequality).
    assert.ok(words.reduce((s, w) => s + 2 ** -w.length, 0) <= 1, colour)
  }
  assert.equal(DATA.codes.clause, '4.1')
})

test('the tables hold the code words copied by hand from the PDF', () => {
  for (const [run, word] of Object.entries(T4_WHITE)) {
    const n = Number(run)
    assert.equal(n < 64 ? CODES.white.terminating[n] : CODES.white.makeUp[n / 64 - 1], word, `white ${run}`)
  }
  for (const [run, word] of Object.entries(T4_BLACK)) {
    const n = Number(run)
    assert.equal(n < 64 ? CODES.black.terminating[n] : CODES.black.makeUp[n / 64 - 1], word, `black ${run}`)
  }
  assert.equal(CODES.eol, T4_EOL)
})

test('the encoder writes the code words of T.4, white first', () => {
  const lines = [[1728], [0, 1728], [0, 1, 1727], [63, 1, 1664], [64, 1664], [13, 2, 1, 1712], [0, 63, 1665]]
  for (const want of lines) {
    const row = line(want)
    assert.deepEqual(runs(row, 1728), want)
    const encoded = encodeLine(row, 1728, CODES)
    assert.equal(encoded, want.map((run, i) => handCode(run, i % 2)).join(''), String(want))
    assert.equal(lineBits(row, 1728, LENGTHS), encoded.length, String(want))
  }
})

test('a run is refused when it is negative, fractional or longer than Table 3a codes', () => {
  assert.throws(() => runCode(-1, 0, CODES), RangeError)
  assert.throws(() => runCode(1.5, 0, CODES), RangeError)
  assert.throws(() => runCode(1792, 1, CODES), RangeError)
  assert.equal(runCode(1727, 1, CODES), T4_BLACK[1664] + CODES.black.terminating[63])
})

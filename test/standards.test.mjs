// Every figure is read from a quote of T.4, T.30 or RFC 3949, and the settings take only what they allow.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEFAULT_RATE, DEFAULT_SCAN_TIME, EQUIVALENT, LINE, MODEMS, QUOTES, RATES, RESOLUTIONS, RTC_EOLS, SCAN_TIMES, settings, TEXTS } from '../dist/index.js'
import { DATA, ROOT } from './helpers.mjs'

test('every quote names its text, its clause and its words', () => {
  assert.equal(Object.keys(QUOTES).length, 42)
  for (const [id, q] of Object.entries(QUOTES)) {
    assert.ok(q.source === 'ITU-T T.4' || q.source === 'ITU-T T.30' || q.source === 'RFC 3949', id)
    assert.ok(q.clause.length > 0 && q.says === q.says.trim() && q.says.length > 0, id)
    assert.equal(q.href, TEXTS[DATA.quotes[id].text].url, id)
  }
})

test('the figures are the ones the quotes give', () => {
  assert.equal(QUOTES['t4-line'].says, 'A total of 1728 picture elements represent one horizontal scan line of 215 mm length.')
  assert.equal(QUOTES['t4-line'].clause, '4.1.1')
  assert.deepEqual(LINE, { pels: 1728, mm: 215 })
  assert.ok(QUOTES['t4-standard'].says.includes('3.85 lines/mm ± 1%'))
  assert.ok(QUOTES['t4-higher'].says.includes('7.7 lines/mm'))
  assert.deepEqual(
    RESOLUTIONS.map((r) => [r.id, r.linesPerMm]),
    [
      ['standard', 3.85],
      ['fine', 7.7],
    ],
  )
  assert.ok(QUOTES['t4-rtc'].says.endsWith('six consecutive EOLs.'))
  assert.equal(RTC_EOLS, 6)
  assert.equal(QUOTES['t4-eol-format'].says, 'Format: 000000000001')
  assert.deepEqual(EQUIVALENT, { dpi: [200, 204], standard: [98, 100], fine: [196, 200] })
  assert.equal(QUOTES['rfc-s-x'].clause, '3.2.1')
})

test('each rate has a DCS cell of T.30 Table 2 that names it and its modem, and V.34 its title', () => {
  assert.deepEqual(
    RATES.map((r) => r.bps),
    [2400, 4800, 7200, 9600, 12000, 14400, 33600],
  )
  for (const r of RATES) {
    const shown = r.bps >= 10000 ? `${Math.floor(r.bps / 1000)} ${String(r.bps % 1000).padStart(3, '0')}` : String(r.bps)
    if (r.ecm) {
      assert.equal(r.bps, 33600)
      assert.ok(MODEMS['v-34'].title.includes(`up to ${shown} bit/s`))
      assert.ok(r.quotes.includes('t30-v34-ecm') && r.quotes.includes('t30-ecm-0ms'))
      continue
    }
    for (const modem of r.modems) {
      const name = modem.replace('ITU-T ', '').replace(/ter$/, ' ter')
      assert.ok(
        r.quotes.some((q) => QUOTES[q].says === `${shown} bit/s, ITU-T Rec. ${name}`),
        `${r.bps} ${modem}`,
      )
    }
    assert.equal(QUOTES[r.quotes[0]].clause, 'Table 2, bits 11 to 14, DCS')
  }
  assert.equal(DEFAULT_RATE.bps, 14400)
})

test('each minimum scan line time is the option its first quote is about', () => {
  assert.deepEqual(
    SCAN_TIMES.map((t) => t.ms),
    [0, 5, 10, 20, 40],
  )
  for (const t of SCAN_TIMES) {
    const first = /(\d+) (?:milliseconds?|ms)\b/.exec(QUOTES[t.quotes[0]].says)
    assert.equal(Number(first?.[1]), t.ms)
    assert.equal(QUOTES[t.quotes[0]].clause, '3.1')
  }
  assert.equal(DEFAULT_SCAN_TIME.ms, 20)
  assert.ok(QUOTES['t4-scan-standard'].says.includes('20 milliseconds standard'))
})

test('each ITU text is the PDF of the edition in force, with a reading date', () => {
  assert.deepEqual(Object.keys(TEXTS).sort(), ['rfc-3949', 't-30', 't-4'])
  assert.equal(TEXTS['t-4'].edition, 'T.4 (07/03)')
  assert.equal(TEXTS['t-4'].url, 'https://www.itu.int/rec/dologin_pub.asp?lang=e&id=T-REC-T.4-200307-I!!PDF-E&type=items')
  assert.equal(TEXTS['t-30'].edition, 'T.30 (09/05)')
  assert.equal(TEXTS['t-30'].url, 'https://www.itu.int/rec/dologin_pub.asp?lang=e&id=T-REC-T.30-200509-I!!PDF-E&type=items')
  for (const t of Object.values(TEXTS)) assert.match(t.read, /^\d{4}-\d{2}-\d{2}$/)
})

test('settings take only the rates and times the standards allow', () => {
  assert.deepEqual(settings(), { resolution: 'standard', bps: 14400, ms: 20 })
  assert.deepEqual(settings({ bps: 33600 }), { resolution: 'standard', bps: 33600, ms: 0 })
  assert.deepEqual(settings({ bps: 9600, ms: 10, resolution: 'fine' }), { resolution: 'fine', bps: 9600, ms: 10 })
  assert.throws(() => settings({ bps: 14401 }), RangeError)
  assert.throws(() => settings({ bps: 28800 }), RangeError)
  assert.throws(() => settings({ ms: 15 }), RangeError)
  assert.throws(() => settings({ bps: 33600, ms: 20 }), /error correction/)
  assert.throws(() => settings({ resolution: 'superfine' }), RangeError)
})

test('the data file ships in the package and holds what the module reads', () => {
  const shipped = JSON.parse(readFileSync(join(ROOT, 'dist', 'standards.json'), 'utf8'))
  assert.deepEqual(shipped, DATA)
  // The site's measured times and limits stay out: only standards figures are here.
  const text = JSON.stringify(DATA).toLowerCase()
  for (const word of ['delivered', 'faxforagents.com', 'measured', 'carrier']) assert.ok(!text.includes(word), word)
})

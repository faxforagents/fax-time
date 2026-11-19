<a href="https://faxforagents.com"><img src="https://faxforagents.com/brand/logo-512.png" width="88" alt="Fax for Agents"></a>

# fax-time

How long the page data of a fax takes on the line, worked out from ITU-T T.4 and T.30. The coder behind the
[fax transmission time tool](https://faxforagents.com/tools/fax-time/) of [Fax for Agents](https://faxforagents.com).

[Website](https://faxforagents.com) ·
[Fax transmission time tool](https://faxforagents.com/tools/fax-time/) ·
[Docs](https://faxforagents.com/docs/) ·
[Dashboard](https://app.faxforagents.com) ·
[Pricing](https://faxforagents.com/pricing/) ·
[Changelog](https://faxforagents.com/changelog/)

[![npm version](https://img.shields.io/npm/v/faxforagents-fax-time?label=npm)](https://www.npmjs.com/package/faxforagents-fax-time)
[![CI](https://img.shields.io/github/actions/workflow/status/faxforagents/fax-time/ci.yml?branch=main&label=ci)](https://github.com/faxforagents/fax-time/actions/workflows/ci.yml)
[![MIT licence](https://img.shields.io/badge/licence-MIT-1f6feb)](https://github.com/faxforagents/fax-time/blob/main/LICENSE)
[![Node 20+](https://img.shields.io/badge/node-20%2B-339933)](https://nodejs.org)
[![ITU-T T.4 (07/03)](https://img.shields.io/badge/ITU--T-T.4%20(07%2F03)-0a6ebd)](https://www.itu.int/rec/T-REC-T.4-200307-I/en)

`faxforagents-fax-time` lays each page on the T.4 scan line and makes it black and white. It codes every
line with Tables 2 and 3a of T.4, the one-dimensional scheme called Modified Huffman. Each line gets its
EOL and enough fill to last the minimum scan line time. Six EOLs end the page. The bits over the modem rate
are the seconds.

The figure is the page data alone. The call set-up, the modem training, the confirmation after each page,
retries and a busy line all add time. This covers the page data only, not the call around it.

It reads TIFF, including fax-coded TIFF, and PBM. It runs in Node 20 and later, has no dependencies and makes
no network request.

## Install

```sh
npm install faxforagents-fax-time
```

The command comes with it as `fax-time`. Run it once without installing:

```sh
npx faxforagents-fax-time page.tif
```

## The command

`fax-time <file>` prints the seconds of each page and the total. This is its output for a three-page Group 4
fax in this repository:

```console
$ fax-time test/fixtures/g4-3-pages.tif
page 1: 22.0 s, 316872 bits (64128 coded, 252744 fill), 1100 lines
page 2: 22.0 s, 316872 bits (62081 coded, 254791 fill), 1100 lines
page 3: 22.0 s, 316872 bits (64452 coded, 252420 fill), 1100 lines
total: 66.0 s for 3 pages at 14 400 bit/s, standard resolution, 20 ms minimum scan line time
This covers the page data only, not the call around it.
```

| Option | What it sets |
|---|---|
| `-r`, `--rate <bit/s>` | The modem rate: 2400, 4800, 7200, 9600, 12000, 14400 (the default) or 33600 |
| `-t`, `--scan-time <ms>` | The minimum scan line time: 0, 5, 10, 20 (the default) or 40 |
| `-f`, `--fine` | Fine resolution, 7.7 lines/mm, in place of standard, 3.85 lines/mm |
| `--resolution <name>` | `standard` (the default) or `fine` |
| `--dpi <x>[x<y>]` | The resolution of a page that gives none, such as every PBM page |
| `--max-pages <n>` | The most pages read from the file, 1000 by default |
| `--json` | The whole result as JSON |
| `-h`, `--help` and `-v`, `--version` | The usage and the version |

At 33600 bit/s the time is 0 ms and no other, because T.30 makes error correction mandatory with V.34. The
command exits 0 when it read every page and 2 for a wrong argument. It exits 1 when the file or one of its pages
could not be read, and when the file has more pages than `--max-pages`.

## The library

From a checkout of this repository, which holds the fixture the example reads:

```js
import { readFile } from 'node:fs/promises'
import { faxTime } from 'faxforagents-fax-time'

const bytes = new Uint8Array(await readFile('test/fixtures/g4-3-pages.tif'))
const t = await faxTime(bytes, { bps: 9600, ms: 10 })
for (const p of t.pages) console.log(p.page, p.seconds.toFixed(1), p.bits)
// 1 12.2 116713
// 2 12.0 115399
// 3 12.1 116236
```

`faxTime` also takes a 1-bit bitmap: `width` by `height` bytes, 0 for white and anything else for black.
Give its `dpi` when you know it. A blank US Letter page at 300 dpi comes out at 1071 lines and 308,520 bits.

```js
const pixels = new Uint8Array(2550 * 3300)
const blank = await faxTime({ width: 2550, height: 3300, pixels, dpi: { x: 300, y: 300 } })
// blank.pages[0]: { lines: 1071, coded: 31131, fill: 277389, bits: 308520, seconds: 21.425, ... }
```

To try several settings on one file, code it once and time it as often as you like:

| Function | What it does |
|---|---|
| `codeFile(bytes, { dpi, limits })` | Codes every page of a TIFF or PBM at both resolutions |
| `codeTiff`, `codePbm`, `codeBitmap` | The same for one kind of input |
| `timeFile(coded, settings)` | Bits and seconds of every coded page |
| `timePage(page, settings)` | Bits and seconds of one coded page |
| `settings({ bps, ms, resolution })` | Checks the settings against the standards and fills in the defaults |

The lower layer is exported too: `encodeLine` and `runCode` write the code words, while `lineBits`, `pageBits`
and `minLineBits` count them. `readTiff` and `readPbm` read the files. Types ship with the package.

## How a page is counted

A page is one EOL, then the data and the EOL of each line, then five more EOLs. The last line's EOL is the
first of the six that end the page. In the minimum scan line time the line carries a number of bits. A line
whose data and EOL are shorter gets fill up to that number, rounded up to a whole bit.

At 14 400 bit/s and 20 ms a line takes at least 288 bits. A blank line codes in 17 bits, plus 12 for its EOL.
So a blank US Letter page is 1071 such lines and 72 bits of EOLs around them, 21.4 seconds.

A page is laid on the 215 mm line at its own size and centred. A page wider than the line is scaled down to fit
it. Each pel is the average of the pixels it covers, and a pel darker than mid-grey is black. A fax page 1728
pels wide at 200 or 204 per inch is coded row for row. RFC 3949 profile S treats its rows as standard lines
at 98 or 100 lines per inch, and as fine lines at 196 or 200. A page with no size on paper is taken as the
full width of the line, and the result says so. Its pixels are square, unless it gives a resolution in no unit,
which TIFF allows for the shape of its pixels.

## Where each figure comes from

No figure is typed into the code. `src/standards.ts` reads each one out of a quote in
[`src/standards.json`](src/standards.json). It also holds each rule the coder follows to the sentence it
rests on, such as the fill of T.4 4.1.3. The module will not load when a quote no longer says its figure or its
rule. The file ships in the package as `faxforagents-fax-time/standards.json`, with the clause of every quote.

To change a quote, edit `src/standards.json` and run `npm run standards`. That writes it into
`src/standards-data.ts`, so no Node version has to import JSON, and the build stops when the two differ.

| Figure | Read from | Text |
|---|---|---|
| 1728 pels along a 215 mm scan line | "A total of 1728 picture elements represent one horizontal scan line of 215 mm length." | T.4 4.1.1, and 2.1 c) |
| 3.85 and 7.7 lines/mm, ± 1% | 2.1 a) and b) | T.4 |
| The code words | Tables 2 and 3a, 64 terminating and 27 make-up codes a colour | T.4 4.1 |
| The EOL, 000000000001 | "Format: 000000000001" | T.4 4.1.2 |
| An EOL before the first line and after each | "This code word follows each line of data." | T.4 4.1.2 |
| Fill up to the minimum time | "Fill must be added ..." | T.4 4.1.3 |
| Six EOLs end the page | "The end of a document transmission is indicated by sending six consecutive EOLs." | T.4 4.1.4 |
| 0, 5, 10, 20 and 40 ms, 20 the default | Items a) to e) of Alternative 1, and the DCS cells of bits 21 to 23 | T.4 3.1, T.30 Table 2 |
| 2400 to 14 400 bit/s | The DCS cells of bits 11 to 14, such as "14 400 bit/s, ITU-T Rec. V.17" | T.30 Table 2 |
| 33 600 bit/s, at 0 ms | The title of V.34, and "The use of the Error Correction Mode (ECM) is mandatory ..." | V.34, T.30 F.3 and Table 2 note 8 |
| 200 and 204 across, 98 and 100 or 196 and 200 down | "... may be treated as equivalent" | RFC 3949 3.2.1 |

The texts are the PDFs of T.4 (07/03) and T.30 (09/05) on itu.int, and RFC 3949. All 42 quotes and every row of
Tables 2 and 3a were found in them again on 2026-11-19 by `scripts/check-sources.py`.

## What it reads

- TIFF: black and white pages, and 8-bit grey or RGB pages, in strips. They can be uncompressed, PackBits, LZW,
  Deflate or fax coded. Fax coding is TIFF compression 2, 3 and 4, in one or two dimensions and in either fill
  order. A page is turned the way its Orientation tag says. Tiles, JPEG, palette images and other bit depths are
  named and not read. So is a page whose tags that shape its pixels cannot be read.
- PBM: raw PBM (P4) and plain PBM (P1), one or more images to a file.
- PDF is not read in version 0.1. Drawing a PDF page in Node needs a canvas, so render it to a TIFF or PBM first.

A damaged file gives a named error. Every offset is checked before it is read, and a page chain that loops
ends. A strip is decoded only as far as its rows need. The strips of a file may add up to no more bytes than the
file holds. A page over the pixel limit is refused, and so is a page whose scan lines
would hold more pels than it.

The limits are 1000 pages, 2^26 pixels a page and 2^30 pixels a file, and `limits` changes them. They come from
no standard. A page can take about six bytes of memory a pixel while it is read, so the default allows about
400 MB. The time grows with the pixels and the pages, so lower the limits for files you do not trust.

## What it leaves out

- The rest of the call: the answer, the exchange of capabilities, the training, the confirmation after each
  page and the hang-up.
- Retries, and a call made again after a busy signal.
- Two-dimensional coding (T.4 4.2), which a call can use in place of the one-dimensional scheme.
- The frames of error correction mode, which T.30 makes mandatory at V.34 rates.
- Alternative 2 of T.4 3.1, where fine resolution takes half the minimum time of standard.
- Colour and grey modes.

## Tests

```sh
npm ci
npm run check
```

The build and lint tools need the newest Node 20, 22 or 24. The package itself runs on Node 20.0 and later, and
CI tests it on 20.0.0, 20, 22 and 24.

The golden tests hold the package to the numbers the
[fax transmission time tool](https://faxforagents.com/tools/fax-time/) gives for the same inputs. They also
hold the encoder to code words copied by hand from the T.4 PDF. The TIFF fixtures in `test/fixtures` were
written by libtiff through Pillow. `scripts/make-fixtures.py` makes them again and works out their bits with a
coder of its own.

## About

[Fax for Agents](https://faxforagents.com) is a fax API, a hosted MCP server and SDKs built so AI agents can
send and receive faxes. It is made by JSB Holdings LLC. Read the [docs](https://faxforagents.com/docs/) to send
a fax from code.

## Licence

MIT, see [LICENSE](LICENSE).

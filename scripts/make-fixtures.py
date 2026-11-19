"""Writes the TIFF fixtures of test/ and test/fixtures/expected.json, with Pillow and its libtiff.

    python3 -m venv .venv && .venv/bin/pip install pillow
    .venv/bin/python scripts/make-fixtures.py

The fixtures are committed, so the tests never need Python. Run this only to make them again.

For each file, expected.json holds what Pillow reads back from it, as a SHA-256 of its pixels (0 for black, 255
for white). For the fax pages, which are 1728 pels wide at 204 by 98 or 204 by 196 per inch and so coded pixel
for pixel, it also holds the scan lines, coded bits and fill bits of each page. This script works those out on
its own: it codes each row of Pillow's pixels with Tables 2 and 3a of T.4 as src/standards.json holds them,
apart from the package's encoder.
"""

from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "test" / "fixtures"
DATA = json.loads((ROOT / "src" / "standards.json").read_text("utf-8"))
CODES = DATA["codes"]
EOL = len(CODES["eol"])
#: The scan line and the RTC, held to the quotes the package reads them from (T.4 4.1.1 and 4.1.4).
PELS, LINE_MM = 1728, 215
RTC_EOLS = 6
if DATA["quotes"]["t4-line"]["says"] != (
    f"A total of {PELS} picture elements represent one horizontal scan line of {LINE_MM} mm length."
) or not DATA["quotes"]["t4-rtc"]["says"].endswith("six consecutive EOLs."):
    sys.exit("make-fixtures: the scan line or the RTC of standards.json is not the one written here")


def run_bits(run: int, colour: int) -> int:
    table = CODES["white" if colour == 0 else "black"]
    if run < 64:
        return len(table["terminating"][run])
    k = run // 64
    return len(table["makeUp"][k - 1]) + len(table["terminating"][run - 64 * k])


def line_bits(row: list[int]) -> int:
    """The bits of one line, 1 for black, white first, as T.4 4.1.1 codes it."""
    bits, colour, length = 0, 0, 0
    for pel in row:
        if pel == colour:
            length += 1
        else:
            bits += run_bits(length, colour)
            colour, length = pel, 1
    return bits + run_bits(length, colour)


def page_bits(lines: list[int], bps: int, ms: int) -> dict[str, int]:
    least = math.ceil(bps * ms / 1000)
    coded = EOL + (RTC_EOLS - 1) * EOL + sum(n + EOL for n in lines)
    fill = sum(max(0, least - (n + EOL)) for n in lines)
    return {"lines": len(lines), "coded": coded, "fill": fill}


def rows_of(im: Image.Image) -> list[list[int]]:
    """Rows of a black and white image, 1 for black."""
    bw = im.convert("1")
    w, h = bw.size
    data = bw.tobytes()
    stride = (w + 7) // 8
    return [[0 if (data[y * stride + x // 8] >> (7 - x % 8)) & 1 else 1 for x in range(w)] for y in range(h)]


def exact(im: Image.Image, bps: int = 14400, ms: int = 20) -> dict[str, int]:
    return page_bits([line_bits(r) for r in rows_of(im)], bps, ms)


def fax_page(height: int, seed: int) -> Image.Image:
    """A page of rules, boxes and words, 1728 pels wide, white with black marks."""
    im = Image.new("1", (PELS, height), 1)
    d = ImageDraw.Draw(im)
    for i in range(0, height - 120, 37 + seed % 5):
        d.line((120, 60 + i, PELS - 120 - (i * 7 + seed) % 600, 60 + i), fill=0, width=2 + (i + seed) % 3)
        d.text((140 + (i * 13) % 400, 70 + i), f"Line {i} of page {seed}", fill=0)
    d.rectangle((200, height // 3, 900, height // 3 + 160), fill=0)
    d.rectangle((0, height - 40, PELS - 1, height - 1), outline=0, width=3)
    return im


def sha_of(path: Path, transpose: bool = False) -> str:
    """The SHA-256 of a file's pixels as Pillow reads them: 0 where black, 255 elsewhere."""
    with Image.open(path) as im:
        seen = ImageOps.exif_transpose(im) if transpose else im
        grey = seen.convert("L").tobytes()
    return hashlib.sha256(bytes(0 if v == 0 else 255 for v in grey)).hexdigest()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    expected: dict[str, dict] = {"decode": {}, "orientation": {}, "line-for-line": {}, "golden": {}}

    # One page in every compression the reader takes, written by libtiff, in either fill order.
    page = Image.new("1", (PELS, 300), 1)
    draw = ImageDraw.Draw(page)
    for y in range(10, 290, 23):
        draw.line((40 + y, y, 1700 - 3 * y, y + 5), fill=0, width=2)
        draw.text((100 + y, y + 3), f"line {y}", fill=0)
    draw.rectangle((300, 120, 700, 200), fill=0)
    for name, options in (
        ("g3-1d", {"compression": "group3"}),
        ("g3-2d", {"compression": "group3", "tiffinfo": {292: 1}}),
        ("g3-2d-aligned-lsb", {"compression": "group3", "tiffinfo": {292: 5, 266: 2}}),
        ("g4", {"compression": "group4"}),
        ("mh-rle", {"compression": "tiff_ccitt"}),
        ("raw", {"compression": "raw"}),
        ("packbits", {"compression": "packbits"}),
        ("lzw", {"compression": "tiff_lzw"}),
        ("deflate", {"compression": "tiff_adobe_deflate"}),
        ("packbits-lsb", {"compression": "packbits", "tiffinfo": {266: 2}}),
        ("lzw-lsb", {"compression": "tiff_lzw", "tiffinfo": {266: 2}}),
        ("raw-lsb", {"compression": "raw", "tiffinfo": {266: 2}}),
    ):
        path = OUT / f"page-{name}.tif"
        page.save(path, dpi=(204, 98), **options)
        expected["decode"][path.name] = {"sha": sha_of(path), "lines": 300}

    # Each of the eight orientations, against Pillow's own turning of the file.
    turned = Image.new("1", (PELS, 300), 1)
    ImageDraw.Draw(turned).rectangle((10, 20, 400, 60), fill=0)
    for value in range(1, 9):
        path = OUT / f"orientation-{value}.tif"
        turned.save(path, compression="group4", dpi=(204, 98), tiffinfo={274: value})
        expected["orientation"][path.name] = {"sha": sha_of(path, transpose=True)}

    # Fax pages at the resolutions RFC 3949 profile S treats as equivalent: coded line for line.
    std = Image.new("1", (PELS, 1100), 1)
    ImageDraw.Draw(std).rectangle((100, 100, 900, 300), fill=0)
    fine = Image.new("1", (PELS, 2200), 1)
    ImageDraw.Draw(fine).rectangle((100, 100, 900, 600), fill=0)
    for name, im, dpi in (("200x100", std, (200, 100)), ("204x98", std, (204, 98)), ("200x200", fine, (200, 200)), ("204x196", fine, (204, 196))):
        path = OUT / f"fax-{name}.tif"
        im.save(path, compression="group4", dpi=dpi)
        expected["line-for-line"][path.name] = {"standard": 1100, "fine": 2200}

    # Pages with exact bits, worked out here: Group 3 and 4, one and two dimensions, several pages.
    g3 = fax_page(1100, 1)
    g3.save(OUT / "g3-standard.tif", compression="group3", dpi=(204, 98))
    expected["golden"]["g3-standard.tif"] = {"resolution": "standard", "pages": [exact(g3)]}
    g3.save(OUT / "g3-2d-standard.tif", compression="group3", dpi=(204, 98), tiffinfo={292: 1})
    expected["golden"]["g3-2d-standard.tif"] = {"resolution": "standard", "pages": [exact(g3)]}
    g4 = fax_page(2200, 2)
    g4.save(OUT / "g4-fine.tif", compression="group4", dpi=(204, 196))
    expected["golden"]["g4-fine.tif"] = {"resolution": "fine", "pages": [exact(g4)]}
    pages = [fax_page(1100, n) for n in (3, 4, 5)]
    pages[0].save(OUT / "g4-3-pages.tif", save_all=True, append_images=pages[1:], compression="group4", dpi=(204, 98))
    expected["golden"]["g4-3-pages.tif"] = {
        "resolution": "standard",
        "pages": [exact(p) for p in pages],
        "also": {"bps": 4800, "ms": 10, "pages": [exact(p, 4800, 10) for p in pages]},
    }

    (OUT / "expected.json").write_text(json.dumps(expected, indent=1) + "\n", "utf-8")
    print(f"make-fixtures: {sum(len(v) for v in expected.values())} files in {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

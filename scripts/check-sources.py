"""Reads the texts again and finds every quote and code word of src/standards.json in them.

    python3 -m venv .venv && .venv/bin/pip install pypdf
    .venv/bin/python -I scripts/check-sources.py

It fetches the T.4 (07/03) and T.30 (09/05) PDFs from itu.int, RFC 3949 from rfc-editor.org and the page of each
modem on itu.int. It fails unless each quote is in its text, each row of Tables 2 and 3a of T.4 is in T.4 as
written, and each modem's page gives its title. Run it by hand when the
quotes are read again, and set "read" of each text and modem in src/standards.json to that day. CI does not run it,
because CI does not fetch.

Exit 0 when everything is found, 1 when something is not, 2 when a text could not be fetched.
"""

from __future__ import annotations

import html
import io
import json
import logging
import re
import sys
import urllib.request
from pathlib import Path

from pypdf import PdfReader

DATA = json.loads((Path(__file__).resolve().parents[1] / "src" / "standards.json").read_text("utf-8"))
AGENT = "Mozilla/5.0 (compatible; faxforagents-fax-time sources check)"


def norm(s: str) -> str:
    for a, b in (("–", "-"), ("—", "-"), ("−", "-"), (" ", " "), ("ﬁ", "fi"), ("ﬂ", "fl"), ("’", "'")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310
        return response.read()


def text_of(text_id: str, url: str) -> str:
    body = fetch(url)
    if body.startswith(b"%PDF"):
        logging.getLogger("pypdf").setLevel(logging.ERROR)
        return norm(" ".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(body)).pages))
    return norm(html.unescape(re.sub(r"<[^>]+>", " ", body.decode("utf-8", "replace"))))


def main() -> int:
    texts: dict[str, str] = {}
    for text_id, t in DATA["texts"].items():
        try:
            texts[text_id] = text_of(text_id, t["url"])
        except OSError as err:
            print(f"check-sources: could not fetch {t['url']}: {err}")
            return 2
    missing = []
    for quote_id, q in DATA["quotes"].items():
        says, text = norm(q["says"]), texts[q["text"]]
        # A table cell can be laid out with other spacing than the sentence it is copied into.
        if says not in text and says.replace(" ", "") not in text.replace(" ", ""):
            missing.append(f"{quote_id} ({q['clause']}): {says}")
    flat = texts["t-4"].replace(" ", "")
    for colour in ("white", "black"):
        codes = DATA["codes"][colour]
        rows = [(i, w) for i, w in enumerate(codes["terminating"])] + [((i + 1) * 64, w) for i, w in enumerate(codes["makeUp"])]
        missing += [f"{colour} {run} {word}" for run, word in rows if f"{run}{word}" not in flat]
    for modem_id, m in DATA["modems"].items():
        try:
            page = text_of(modem_id, m["url"])
        except OSError as err:
            print(f"check-sources: could not fetch {m['url']}: {err}")
            return 2
        if norm(m["title"]) not in page:
            missing.append(f"{modem_id}: the title {m['title']}")
    for line in missing:
        print(f"missing: {line}")
    print(f"check-sources: {len(DATA['quotes'])} quotes, {len(missing)} missing")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())

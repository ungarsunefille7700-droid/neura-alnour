"""Builds data/hadiths/<book>.json.gz, the hadith base used to check every hadith reference
(neura_religion.py), from the open data of fawazahmed0/hadith-api (The Unlicense):
https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/<edition>.json

Numbering kept = the one used to cite hadiths (checked on sunnah.com, 2026-10-21):
- Muslim: Muhammad Fu'ad Abdul-Baqi ("arabicnumber", e.g. 1907); the sequential number of the
  edition is NOT used to cite Muslim;
- the other books: the edition's number (identical to sunnah.com for the checked references).
Grades: as given by the source, with the scholar's name (none for Bukhari and Muslim).

Usage: python build_hadith_db.py <folder with the downloaded editions>"""
import gzip
import json
import sys
from pathlib import Path

BOOKS = {
    "bukhari": "Sahih al-Bukhârî", "muslim": "Sahih Muslim", "abudawud": "Sunan Abû Dâwûd",
    "tirmidhi": "Jâmiʿ at-Tirmidhî", "nasai": "Sunan an-Nasâ'î", "ibnmajah": "Sunan Ibn Mâjah",
    "malik": "Muwatta' de Mâlik", "nawawi": "Les 40 hadiths d'an-Nawawî",
}
OUT = Path(__file__).resolve().parent.parent / "data" / "hadiths"


def edition(src, name):
    path = src / f"{name}.json"
    if not path.exists():
        return {}
    return {h["hadithnumber"]: h for h in json.loads(path.read_text(encoding="utf-8"))["hadiths"]}


def standard_number(book, item):
    if book == "muslim":
        arabic = str(item.get("arabicnumber") or "").strip()
        return arabic.split(".")[0] if arabic and arabic != "0" else None
    return str(item["hadithnumber"]).split(".")[0]


def build(src):
    OUT.mkdir(parents=True, exist_ok=True)
    for book, title in BOOKS.items():
        eng, fra, ara = edition(src, f"eng-{book}"), edition(src, f"fra-{book}"), edition(src, f"ara-{book}1")
        rows = []
        for seq, item in sorted(eng.items()):
            number = standard_number(book, item)
            if not number:
                continue
            rows.append({
                "n": number,
                "v": str(item.get("arabicnumber") or item["hadithnumber"]),
                "en": (item.get("text") or "").strip(),
                "fr": (fra.get(seq, {}).get("text") or "").strip(),
                "ar": (ara.get(seq, {}).get("text") or "").strip(),
                "g": [[g.get("name", ""), g.get("grade", "")] for g in item.get("grades") or []],
            })
        doc = {"book": book, "title": title, "count": len(rows),
               "source": "fawazahmed0/hadith-api (The Unlicense), editions eng/fra/ara",
               "numbering": "Abdul-Baqi" if book == "muslim" else "edition (= sunnah.com)", "hadiths": rows}
        with gzip.open(OUT / f"{book}.json.gz", "wt", encoding="utf-8") as handle:
            json.dump(doc, handle, ensure_ascii=False, separators=(",", ":"))
        print(book, len(rows), "hadiths", round((OUT / f"{book}.json.gz").stat().st_size / 1e6, 1), "Mo")


if __name__ == "__main__":
    build(Path(sys.argv[1]))

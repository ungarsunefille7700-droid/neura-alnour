"""French translations of the meanings of the Quran (QuranEnc.com), read-only.

Two translations, copied without any change (see data/quran_fr/SOURCE.md for the terms of QuranEnc):
- french_rashid  : Rachid Maach, version 1.0.3
- french_montada : Dr Nabil Rudwan, Noor International Center, version 1.0.0

The files are never written. A text shown to a user is given exactly as stored, with the translator,
« QuranEnc.com » and the version (conditions 1 to 3 of QuranEnc). The folded copies kept in memory are
used only to compare an answer with the verses."""
from __future__ import annotations

import re
import sqlite3
from functools import lru_cache
from pathlib import Path
from typing import Dict, Optional, Tuple

DATA = Path(__file__).resolve().parent / "data" / "quran_fr"

TRANSLATIONS = {
    "rashid": {"file": "french_rashid.sqlite", "translator": "Rachid Maach", "version": "1.0.3"},
    "montada": {"file": "french_montada.sqlite", "translator": "Dr Nabil Rudwan (Noor International Center)", "version": "1.0.0"},
}


def attribution(key: str = "rashid") -> str:
    t = TRANSLATIONS[key]
    return f"traduction du sens par {t['translator']}, QuranEnc.com, version {t['version']}"


@lru_cache(maxsize=None)
def _rows(key: str) -> Dict[Tuple[int, int], str]:
    """{(surah, verse): translation} exactly as published (the database is opened read-only)."""
    path = DATA / TRANSLATIONS[key]["file"]
    con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        return {(int(s), int(a)): t or "" for s, a, t in con.execute("select sura, aya, translation from translations")}
    finally:
        con.close()


def available() -> bool:
    return all((DATA / t["file"]).exists() for t in TRANSLATIONS.values())


def translation(surah: int, ayah: int, key: str = "rashid") -> Optional[str]:
    """The published text of one verse, unchanged (translator's note markers like « [25] » included)."""
    try:
        return _rows(key).get((surah, ayah))
    except (OSError, sqlite3.Error):
        return None


def for_comparison(text: str) -> str:
    """Only for comparing (never shown): without the verse number put first (« 78. ») and the note markers."""
    text = re.sub(r"^\s*\d{1,3}\s*\.\s*", "", text or "")
    return re.sub(r"\[\d{1,4}\]", " ", text)


def verses(key: str = "rashid") -> Dict[Tuple[int, int], str]:
    try:
        return _rows(key)
    except (OSError, sqlite3.Error):
        return {}

"""Checks an Arabic text read in an image against the authentic Quran text, word by word,
without any AI: which surah and verses it is, and every word that differs.

Reference text: Tanzil "Simple Clean" (data/quran_simple_clean.json, verbatim). The check
ignores the vowels (tashkeel) and the spelling variants of alef / hamza / ya / ta marbuta:
it verifies the words, not the vowel marks."""
from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

DATA = Path(__file__).resolve().parent / "data" / "quran_simple_clean.json"
_MARKS = re.compile("[ؐ-ًؚ-ٰٟۖ-ۭـ﻿]")
_WORD = re.compile("[ء-يٱیک]+")
_SAME = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ی": "ي", "ة": "ه", "ؤ": "و", "ئ": "ي", "ک": "ك"})
BASMALA = ["بسم", "الله", "الرحمن", "الرحيم"]
SHINGLE = 3


def words(text: str) -> List[str]:
    """The Arabic words of a text, without vowels, in a single spelling."""
    return [w.translate(_SAME) for w in _WORD.findall(_MARKS.sub("", text or ""))]


@lru_cache(maxsize=1)
def _index():
    doc = json.loads(DATA.read_text(encoding="utf-8"))
    flat, where, original, names = [], [], [], {}
    for surah in doc["surahs"]:
        names[surah["n"]] = (surah["name"], surah["en"])
        for number, text in enumerate(surah["ayahs"], 1):
            raw = _MARKS.sub("", text).split()
            norm = [w.translate(_SAME) for w in raw]
            # The basmala written at the start of the first verse (surahs 2-8, 10-114) is not part of it.
            if number == 1 and surah["n"] not in (1, 9) and norm[:4] == BASMALA:
                raw, norm = raw[4:], norm[4:]
            for r, w in zip(raw, norm):
                flat.append(w)
                original.append(r)
                where.append((surah["n"], number))
    shingles = {}
    for i in range(len(flat) - SHINGLE + 1):
        shingles.setdefault(tuple(flat[i:i + SHINGLE]), []).append(i)
    return flat, where, original, names, shingles


def check(text: str, min_words: int = 3) -> Optional[dict]:
    """None when the text is not (mostly) a passage of the Quran; otherwise the surah, the
    verses and the differences ([] = the words are identical to the authentic text)."""
    seen = words(text)
    basmala = seen[:4] == BASMALA and len(seen) >= 4 + min_words
    if basmala:
        seen = seen[4:]
    if len(seen) < min_words:
        return None
    flat, where, original, names, shingles = _index()
    votes, hits = {}, {}
    for i in range(len(seen) - SHINGLE + 1):
        for position in shingles.get(tuple(seen[i:i + SHINGLE]), ()):
            votes[position - i] = votes.get(position - i, 0) + 1
            hits.setdefault(position - i, []).append(position)
    if not votes:
        return None
    # Some phrases are in the Quran several times: the best places are all compared, and the
    # one that matches the most words is kept.
    best = None
    for offset in sorted(votes, key=votes.get, reverse=True)[:5]:
        candidate = _align(seen, offset, hits[offset], flat, where, original)
        if candidate and (best is None or candidate["matched"] > best["matched"]):
            best = candidate
    if best is None or best["matched"] < min_words or best["matched"] / len(seen) < 0.6:
        return None
    changed = sum(len(d["image"].split()) + len(d["quran"].split()) for d in best["diffs"])
    if best["diffs"] and changed > max(3, len(seen) // 4):
        return None  # too different to be sure where it comes from: no verdict rather than a wrong one
    surah, first, last, diffs, matched = best["surah"], best["first"], best["last"], best["diffs"], best["matched"]
    name, english = names[surah]
    ayah_start = where[first][1]
    if basmala and surah == 1 and ayah_start == 2:
        ayah_start = 1  # in Al-Fatiha the basmala is the first verse
    return {
        "surah": surah, "name": name, "english": english,
        "ayah_start": ayah_start, "ayah_end": where[last][1],
        "basmala": basmala, "identical": not diffs, "diffs": diffs,
        "similarity": round(matched / len(seen), 3),
    }


def _align(seen, offset, found, flat, where, original):
    surah = where[found[len(found) // 2]][0]  # where the matching words really are
    slack = 6
    start = max(0, offset - slack)
    while start < len(flat) and where[start][0] != surah:
        start += 1
    end = min(len(flat), offset + len(seen) + slack)
    while end > start and where[end - 1][0] != surah:
        end -= 1
    matcher = SequenceMatcher(None, seen, flat[start:end], autojunk=False)
    blocks = [b for b in matcher.get_matching_blocks() if b.size]
    if not blocks:
        return None
    first, last = start + blocks[0].b, start + blocks[-1].b + blocks[-1].size - 1
    diffs = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        q1, q2 = start + j1, start + j2
        if q2 <= first or q1 > last:  # only the part of the window the image really covers
            if tag == "delete":
                diffs.append({"kind": "ajouté", "ayah": where[min(max(q1, first), last)][1],
                              "image": " ".join(seen[i1:i2]), "quran": ""})
            continue
        q1, q2 = max(q1, first), min(q2, last + 1)
        diffs.append({
            "kind": {"replace": "remplacé", "delete": "ajouté", "insert": "manquant"}[tag],
            "ayah": where[q1 if q2 > q1 else min(q1, last)][1],
            "image": " ".join(seen[i1:i2]),
            "quran": " ".join(original[q1:q2]),
        })
    return {"surah": surah, "first": first, "last": last, "diffs": diffs, "matched": sum(b.size for b in blocks)}


def verification_note(result: dict) -> str:
    """What the AI is told before answering: the result of the check, to use as it is."""
    verses = (f"verset {result['ayah_start']}" if result["ayah_start"] == result["ayah_end"]
              else f"versets {result['ayah_start']} à {result['ayah_end']}")
    head = (f"\n\nVÉRIFICATION AUTOMATIQUE DU TEXTE CORANIQUE (faite par l'application, mot à mot, avec le texte de "
            f"référence Tanzil, sans tenir compte des voyelles) : le texte arabe de l'image correspond à la sourate "
            f"{result['surah']} {result['english']} ({result['name']}), {verses}. ")
    if result["identical"]:
        body = ("Résultat : les mots sont IDENTIQUES au texte authentique. (Les voyelles ne sont pas vérifiées par cette "
                "comparaison : ne garantis pas le tashkeel.)")
    else:
        lines = []
        for diff in result["diffs"]:
            if diff["kind"] == "remplacé":
                lines.append(f"verset {diff['ayah']} : l'image a « {diff['image']} », le texte authentique a « {diff['quran']} »")
            elif diff["kind"] == "manquant":
                lines.append(f"verset {diff['ayah']} : il manque « {diff['quran']} » dans l'image")
            else:
                lines.append(f"verset {diff['ayah']} : l'image ajoute « {diff['image']} », absent du texte authentique")
        body = ("Résultat : le texte de l'image N'EST PAS EXACT. Différences trouvées : " + " ; ".join(lines)
                + ". Dis-le clairement et donne ces différences telles quelles, sans en inventer d'autres ; ne dis jamais "
                "que ce texte est exact.")
    return head + body + " Utilise ce résultat tel quel."

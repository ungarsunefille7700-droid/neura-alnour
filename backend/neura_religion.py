"""Religious reliability of Neura Al Noor: the answers about Islam are grounded in verified sources
BEFORE they are written, and every reference they contain is checked AFTER, without AI:

- Quran: the authentic text (Tanzil, data/quran_simple_clean.json, through neura_quran): the surah
  exists, the verse exists, the number of verses of a surah, the Arabic text quoted (word by word);
- hadiths: data/hadiths (8 collections, 36,088 hadiths, Arabic / English / French, grades with the
  scholar who gave them; Muslim numbered like Abdul-Baqi, as on sunnah.com): the number exists, the
  hadith at that number really says what the answer attributes to it, the narrator, the grade;
- fundamentals: data/religion/fiches.json (pillars, prayers and rakats, ablutions, tayammum,
  fasting, zakat, hajj, recognised differences between the schools…), every reference in it tested.

Nothing here is a filter on words: a reference is accepted because it was found in the sources and
matches, never because it looks credible. Non-religious requests are not touched (prepare() says so)."""
from __future__ import annotations

import gzip
import json
import math
import os
import re
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import neura_quran
import neura_quran_fr

DATA = Path(__file__).resolve().parent / "data"

BOOKS = {
    "bukhari": "al-Bukhârî", "muslim": "Muslim", "abudawud": "Abû Dâwûd", "tirmidhi": "at-Tirmidhî",
    "nasai": "an-Nasâ'î", "ibnmajah": "Ibn Mâjah", "malik": "le Muwatta' de Mâlik", "nawawi": "les 40 hadiths d'an-Nawawî",
}
# How the collections are written in answers and questions (French, English, Arabic transliterations).
BOOK_PATTERNS = {
    "bukhari": r"b(?:ou|u|o)kh[aâ]r[iîy]|البخاري",
    "muslim": r"\bm(?:ou|u|o)sl[iî]m\b|مسلم",
    "abudawud": r"ab[uoûiî]+\s*-?\s*d[aâ]w[uoû]+d|ab[uoû]+\s*-?\s*da[ou]u?d|abou\s*daoud|أبو داود|ابو داود",
    "tirmidhi": r"t[ie]rmidh[iîy]|t[ie]rmid[iîy]|الترمذي",
    "nasai": r"nas[aâ]['’ʾ]?[iîy]\b|an-?nas[aâ]|النسائي",
    "ibnmajah": r"ibn\s*-?\s*m[aâ]dj?(?:ah|a)\b|ibn\s*-?\s*m[aâ]j(?:ah|a)\b|ابن ماجه",
    "malik": r"muwatt?a['’]?|mouwatt?a|الموطأ",
    "nawawi": r"40\s+hadiths|quarante\s+hadiths|arba['’]?[iî]n",
}
_BOOK_RE = re.compile("|".join(f"(?P<{k}>{v})" for k, v in BOOK_PATTERNS.items()), re.I)
# A hadith number: "n°6114", "numéro 6114", "hadith 6114", "#6114", "(6114)", "Bukhari 6114".
_NUMBER_RE = re.compile(r"(?:n\s*[°ºo]\.?\s*:?\s*|num[ée]ro\s*:?\s*|hadith\s*:?\s*|hadîth\s*:?\s*|no\.\s*|#(?=\d)|\(\s*)(\d{1,5})(?!\s*(?:h\b|ans?\b|%|€|/))|(?<=\s)(\d{1,5})(?=[\s),.;:]|$)", re.I)

RELIGIOUS_RE = re.compile(
    r"\b(islam\w*|musulman\w*|muslims?|coran\w*|qur'?an\w*|koran|sourates?|surahs?|versets?|ayat|hadiths?|hadîths?|"
    r"sunna|sunnah|proph[eè]tes?|messager d'allah|allah|pri[eè]res? (?:du|de l'|obligatoires?)|salat|rakats?|rak'?as?|rakʿa|"
    r"ablutions?|wudu|woudou|tayammum|tayamoum|ghusl|je[uû]ne du ramadan|ramadan|zakat|zak[aâ]t|hajj|p[eè]lerinage|umra|"
    r"omra|fiqh|halal|haram|charia|sharia|chari'?a|imams?|mosqu[ée]es?|fatwas?|madhhab|[ée]coles? juridiques?|malikites?|hanafites?|"
    r"chaf[ée]ites?|shafi'?ites?|hanbalites?|califes?|h[ée]gire|sira|s[iî]rah|kaaba|jumu'?a|fajr|dhuhr|dohr|maghrib|"
    r"isha|icha|witr|tarawih|jibril|tafsir|tawhid|chahada|shahada|basmala|bismillah|mushaf|sahaba|que dit dieu|dieu dit|"
    r"piliers? de (?:la foi|l'islam|l'iman)|arkan al|arkân al|qui rapporte|rapport[ée]e? par|"
    r"bukh[aâ]r[iî]|boukhari|tirmidh[iî]|nasa'?[iî]|ibn m[aâ]jah?|ab[uo]u? d[aâ]w[uo]u?d)\b"
    r"|ﷺ|الله|النبي|الرسول|حديث|سورة|آية|القرآن|الإسلام|صلاة|الصلاة|صوم|زكاة|الحج|وضوء|تيمم",
    re.I,
)
HADITH_TALK_RE = re.compile(r"hadith|hadîth|ahadith|proph[eè]te (?:a|aurait) dit|parole du proph|rapport[ée] par|"
                            r"qui rapporte|authenti|sahih|sahîh|da'?if|faible|forg[ée]|recueil|r[ée]f[ée]rence|"
                            r"sunnah?\b|bukh|boukh|muslim|tirmidh|nasa|ibn m[aâ]j|abu d[aâ]w|حديث|narrat", re.I)
NOTE_HEAD = "\n\n---\n**Vérification automatique des sources**"

STOP = set("""a ai au aux avec ce ces cet cette ci comme dans de des du elle elles en est et etre eu il ils je la le les leur
lui ma mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses si son sur ta te tes toi ton tu
un une vos votre vous y c d j l m n s t qu est-ce quel quelle quels quelles dit dire sont ete etait fait faire plus tres
tout tous toute toutes bien donc alors car aussi ainsi cela ca celui celle ceux the of and to in is that it was he for on
with as his they be at by this from or have an had not are but were which their one all would there what so if about no
out up who will then them she been when has more its said can into him than other do only like hadith hadiths authentique
source sources reference references numero recueil prophete messager allah rapporte rapportee rapportes rapporter cite
citer donne donner moi quel lequel laquelle exact exacte texte parle parlent selon ibn bin abu abou umm sahih sunan
bukhari boukhari muslim mouslim tirmidhi nasai majah dawud malik imam version versions classe classes juge jugee
considere consideree egalement savant savants degre chaine ceci celle ceux voici voila narrated reported messenger
chez quand comment pourquoi combien dont lorsque ou quoi trouve trouver existe recueil recueils edition conseil-moi
bon bonne celebre fameux fameuse connu connue trois deux quatre exacts exactes precis precise numeros authentiques sahihs
contre vers entre""".split())

FICHES = DATA / "religion" / "fiches.json"


# ----------------------------------------------------------------- text helpers
def fold(text: str) -> str:
    """Lowercase, without accents, apostrophes unified (for comparisons only)."""
    text = unicodedata.normalize("NFKD", (text or "").replace("’", "'").replace("ʿ", "").replace("ʾ", ""))
    return "".join(c for c in text if not unicodedata.combining(c)).lower()


def content_words(text: str) -> List[str]:
    words = re.findall(r"[a-z]+", fold(text))
    out = [w for w in words if len(w) > 2 and w not in STOP]
    out += neura_quran.words(text)  # Arabic words, in the spelling used by the Quran check
    return out


def _stem(word: str) -> str:
    return word[:5] if len(word) > 5 else word


# Some texts of the base exist only in English or Arabic (at-Tirmidhî, part of Muslim): the usual words of
# the hadiths are also looked for in English. Keys and values are compared by their first letters.
FR_EN = {
    "sourire": ["smil"], "aumone": ["charit", "sadaq"], "voisin": ["neighb"], "colere": ["anger", "angry"],
    "mere": ["mother"], "pere": ["father"], "parents": ["parent"], "paradis": ["paradise", "garden"], "enfer": ["hell", "fire"],
    "priere": ["pray", "salat"], "prier": ["pray"], "jeune": ["fast"], "jeuner": ["fast"], "ablution": ["ablution", "wudu"],
    "purification": ["purif", "clean"], "proprete": ["clean"], "foi": ["faith", "belie", "iman"], "croyant": ["believ"],
    "musulman": ["muslim"], "frere": ["brother"], "soeur": ["sister"], "femme": ["woman", "wife"], "femmes": ["women", "wives"],
    "enfant": ["child"], "enfants": ["children"], "orphelin": ["orphan"], "pauvre": ["poor"], "riche": ["rich"],
    "science": ["knowledge"], "savoir": ["knowledge"], "apprendre": ["learn"], "enseigner": ["teach"], "coran": ["qur"],
    "intention": ["intent"], "intentions": ["intent"], "action": ["deed", "action"], "actions": ["deed", "action"],
    "patience": ["patien"], "patient": ["patien"], "pudeur": ["modest", "haya"], "mensonge": ["lie", "lying"],
    "mentir": ["lie"], "verite": ["truth"], "fort": ["strong"], "force": ["strong", "strength"], "maitrise": ["control"],
    "lutte": ["wrestl"], "terrasse": ["wrestl", "overcom"], "langue": ["tongue"], "main": ["hand"], "mains": ["hands"],
    "coeur": ["heart"], "coeurs": ["hearts"], "corps": ["bod"], "visage": ["face"], "regarde": ["look"], "sang": ["blood"],
    "mort": ["death", "die"], "tombe": ["grave"], "repentir": ["repent"], "pardon": ["forgiv"], "misericorde": ["merc"],
    "bonte": ["kind"], "bienfaisance": ["kind", "good"], "bien": ["good"], "mal": ["evil", "bad"], "chemin": ["path", "road"],
    "voyage": ["journey", "travel"], "voyageur": ["travel"], "malade": ["sick", "ill"], "maladie": ["sick", "disease"],
    "eau": ["water"], "nourriture": ["food"], "manger": ["eat"], "mange": ["eat"], "boire": ["drink"], "oubli": ["forg"],
    "mosquee": ["mosque"], "vendredi": ["friday"], "nuit": ["night"], "jour": ["day"], "mois": ["month"], "lune": ["moon"],
    "ange": ["angel"], "anges": ["angels"], "seigneur": ["lord"], "messager": ["messenger"], "prophete": ["prophet"],
    "connaissance": ["knowledge"], "invocation": ["supplic", "invoc"], "pierre": ["stone", "rock"], "epine": ["thorn"],
    "route": ["road", "way"], "egare": ["lost", "astray"], "bon": ["good"], "conseil": ["advi", "sincer"], "religion": ["religion"],
    "facile": ["easy", "facilit"], "facilitez": ["facilit"], "difficile": ["hard", "difficult"], "commerce": ["trade", "sale"],
    "licite": ["lawful"], "illicite": ["unlawful"], "doute": ["doubt"], "dette": ["debt"], "jalousie": ["envy", "jealous"],
    "salutation": ["greet", "salam"], "salam": ["greet", "salam"], "invite": ["guest"], "invites": ["guest"], "honore": ["honou", "honor"],
}
_FR_EN = {_stem(k): [_stem(v) for v in vs] for k, vs in FR_EN.items()}
# The French texts of the base and the answers translate the same Arabic words differently.
FR_SYNONYMS = [
    ["science", "connaissance", "savoir"], ["obligation", "obligatoire", "devoir"], ["recherche", "chercher", "quete"],
    ["bati", "fonde", "repose", "base", "construit", "edifie"], ["valent", "valeur", "recompense", "depend"],
    ["terrasse", "lutte", "emporte", "domine", "vainc"], ["maitrise", "domine", "controle", "retient"],
    ["aumone", "charite", "sadaqa"], ["purification", "proprete", "purete"], ["moitie", "partie"],
    ["paradis", "jardin"], ["colere", "furieux", "emporte"], ["intention", "intentions", "niyya"],
    ["conseil", "sincerite", "nasiha", "bienveillance"], ["jibril", "gabriel", "jibrail"], ["radieux", "souriant", "joyeux", "rayonnant"],
    # the French translations of the Quran say the same words differently (Rachid Maach, Noor International, Hamidullah…)
    ["endurant", "endurants", "patient", "patients", "patience", "constance", "constants", "perseverants"],
    ["pieux", "piete", "craindre", "crainte", "preserver", "taqwa"],
    ["accomplis", "acquitte", "etablis", "observe"], ["actions", "oeuvres", "actes"], ["effacent", "dissipent", "chassent"],
    ["rappel", "exhortation", "edification"], ["unique", "seul"], ["divinite", "dieu"], ["obscurite", "tenebres"],
    ["deliberement", "intentionnellement", "volontairement", "sciemment", "expres"], ["prepare", "prenne", "occupe", "installe"],
    ["etonnante", "etonnant", "merveilleuse", "admirable"],
]
for _group in FR_SYNONYMS:
    for _word in _group:
        _FR_EN.setdefault(_stem(_word), [])
        _FR_EN[_stem(_word)] += [_stem(other) for other in _group if other != _word]


def _words_text(text: str) -> str:
    """« Le fort n'est pas… » -> " le fort n est pas … ": words separated by single spaces, for word-start matching."""
    return " " + re.sub(r"[^a-z0-9]+", " ", fold(text)) + " "


def _present(word: str, haystack: str) -> bool:
    """The word starts a word of the text (« fort » is found in « fort », never in « effort »)."""
    stem = " " + _stem(word)
    return stem in haystack or any(" " + en in haystack for en in _FR_EN.get(_stem(word), ()))


def _coverage(words: List[str], haystack: str) -> float:
    """Part of the words (compared by their first letters, or their usual English equivalent) present in a folded text."""
    words = list(dict.fromkeys(words))
    if not words:
        return 0.0
    return sum(1 for w in words if _present(w, haystack)) / len(words)


def _skeleton(name: str) -> str:
    """Consonants of a transliterated name: Abu Hurayra / Abou Houraira / Huraira -> 'hrr'."""
    s = fold(name).replace("ch", "sh").replace("ou", "u").replace("dh", "d").replace("th", "t").replace("kh", "k")
    return re.sub(r"[^bcdfgjklmnpqrstvxz]", "", s)


# ----------------------------------------------------------------- sources
@lru_cache(maxsize=None)
def _book(book: str) -> dict:
    """One collection: {number: [entries]}, with the folded text used for the comparisons."""
    path = DATA / "hadiths" / f"{book}.json.gz"
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        doc = json.load(handle)
    by_n: Dict[str, list] = {}
    for row in doc["hadiths"]:
        # Kept in memory: the folded French + English text (compared) and the start of each (shown). The
        # Arabic text (mostly the chain of narrators) stays in the file: memory matters on a small server.
        text = row.get("fr") or row.get("en") or ""  # French when the base has it, else English (at-Tirmidhî)
        slim = {"n": row["n"], "g": row.get("g") or [], "fr": (row.get("fr") or "")[:600],
                "en": "" if row.get("fr") else (row.get("en") or "")[:600], "k": _words_text(text)}
        by_n.setdefault(row["n"], []).append(slim)
    rows = [r for versions in by_n.values() for r in versions]
    fr_share = sum(1 for r in rows if r["fr"]) / max(1, len(rows))  # at-Tirmidhî: English only
    return {"title": doc["title"], "numbering": doc["numbering"], "by_n": by_n, "fr_share": fr_share}


def hadith(book: str, number: str) -> List[dict]:
    try:
        return _book(book)["by_n"].get(str(int(number)), [])
    except (OSError, ValueError):
        return []


def search_hadith(query: str, limit: int = 3, minimum: float = 0.6, prefer: Tuple[str, ...] = (),
                  books: Tuple[str, ...] = ()) -> List[Tuple[float, str, dict]]:
    """Hadiths of the base that contain most of the words of a quotation; the most precise first (all the
    words, then the shortest text), the collections named by the user first on equal scores (books: only those)."""
    words = list(dict.fromkeys(content_words(query)))
    if len(words) < 2:
        return []
    span = max(160, int(2.5 * len(query)))
    # what _present() looks for, prepared once; a text is left as soon as it can no longer reach the minimum
    needles = [(" " + _stem(w),) + tuple(" " + en for en in _FR_EN.get(_stem(w), ())) for w in words]
    need = max(2, math.ceil(minimum * len(words) - 1e-9))
    found = []
    for book in books or BOOKS:
        for number, rows in _book(book)["by_n"].items():
            for row in rows:
                k, hits, left = row["k"], 0, len(needles)
                for alternatives in needles:
                    left -= 1
                    if any(a in k for a in alternatives):
                        hits += 1
                    elif hits + left < need:
                        break
                if hits >= 2 and hits / len(words) >= minimum and _local(words, row["k"], span):  # one saying, not a long story
                    found.append((hits / len(words), -len(row["k"]), book, number, row))
    found.sort(key=lambda item: (item[0], item[2] in prefer, item[1]), reverse=True)
    out, seen = [], set()
    for score, _, book, number, row in found:
        if (book, number) not in seen:
            seen.add((book, number))
            out.append((round(score, 2), book, row))
        if len(out) == limit:
            break
    return out


@lru_cache(maxsize=1)
def _quran():
    doc = json.loads(neura_quran.DATA.read_text(encoding="utf-8"))
    surahs = {s["n"]: s for s in doc["surahs"]}
    names = {}
    for n, s in surahs.items():
        for alias in [s["en"]] + FRENCH_NAMES.get(n, []):
            names[_name_key(alias)] = n
    return surahs, names


def _name_key(name: str) -> str:
    s = fold(name)
    s = re.sub(r"^(al|an|ar|as|at|ad|adh|ash|az|ach|el|l)[- ']", "", s)
    s = s.replace("aa", "a").replace("ee", "i").replace("oo", "u").replace("ou", "u").replace("ch", "sh")
    return re.sub(r"[^a-z]", "", s)


# Common French names / meanings of the surahs (the transliterations of the Tanzil data are added).
FRENCH_NAMES = {
    1: ["Fatiha", "Fâtiha", "L'Ouverture"], 2: ["Baqara", "Baqarah", "La Vache"], 3: ["Al Imran", "Âl ʿImrân", "Imran"],
    4: ["Nisa", "Nissa", "Les Femmes"], 5: ["Maida", "Mâ'ida", "La Table servie"], 6: ["Anam", "An'am", "Les Bestiaux"],
    7: ["Araf", "A'raf"], 8: ["Anfal", "Le Butin"], 9: ["Tawba", "Tawbah", "Le Repentir", "Bara'a"], 10: ["Yunus", "Younous", "Jonas"],
    11: ["Hud", "Houd"], 12: ["Yusuf", "Youssouf", "Joseph"], 13: ["Rad", "Ra'd", "Le Tonnerre"], 14: ["Ibrahim", "Abraham"],
    16: ["Nahl", "Les Abeilles"], 17: ["Isra", "Isrâ'", "Le Voyage nocturne", "Bani Israil"], 18: ["Kahf", "La Caverne"],
    19: ["Maryam", "Marie"], 20: ["Taha", "Tâ-Hâ", "Ta Ha"], 21: ["Anbiya", "Les Prophètes"], 22: ["Hajj", "Le Pèlerinage"],
    23: ["Muminun", "Mu'minun", "Les Croyants"], 24: ["Nur", "Nour", "La Lumière"], 25: ["Furqan", "Fourqane", "Le Discernement"],
    26: ["Shuara", "Shu'ara", "Chou'ara", "Les Poètes"], 27: ["Naml", "Les Fourmis"], 28: ["Qasas", "Le Récit"],
    29: ["Ankabut", "Ankabout", "L'Araignée"], 30: ["Rum", "Roum", "Les Romains"], 31: ["Luqman", "Louqmane"],
    32: ["Sajda", "Sajdah", "La Prosternation"], 33: ["Ahzab", "Les Coalisés"], 36: ["Yasin", "Ya-Sin", "Yâ-Sîn", "Yaseen"],
    37: ["Saffat", "Les Rangés"], 38: ["Sad", "Sâd"], 39: ["Zumar", "Zoumar", "Les Groupes"], 40: ["Ghafir", "Mumin"],
    41: ["Fussilat", "Foussilat"], 42: ["Shura", "Choura", "La Consultation"], 43: ["Zukhruf", "Zoukhrouf"],
    44: ["Dukhan", "Doukhane", "La Fumée"], 47: ["Muhammad", "Mohammed"], 48: ["Fath", "La Victoire"],
    49: ["Hujurat", "Houjourat", "Les Appartements"], 50: ["Qaf"], 53: ["Najm", "L'Étoile"], 54: ["Qamar", "La Lune"],
    55: ["Rahman", "Rahmane", "Le Tout Miséricordieux"], 56: ["Waqia", "Waqi'a", "L'Événement"], 57: ["Hadid", "Le Fer"],
    59: ["Hashr", "Hachr", "L'Exode"], 62: ["Jumua", "Jumu'a", "Joumou'a", "Le Vendredi"], 63: ["Munafiqun", "Les Hypocrites"],
    65: ["Talaq", "Le Divorce"], 66: ["Tahrim", "L'Interdiction"], 67: ["Mulk", "Moulk", "La Royauté"], 68: ["Qalam", "La Plume"],
    71: ["Nuh", "Nouh", "Noé"], 72: ["Jinn", "Djinn", "Les Djinns"], 73: ["Muzzammil", "Mouzzammil"], 74: ["Muddaththir", "Mouddathir"],
    75: ["Qiyama", "Qiyamah", "La Résurrection"], 76: ["Insan", "L'Homme", "Dahr"], 78: ["Naba", "Naba'", "La Nouvelle"],
    80: ["Abasa", "Abassa"], 81: ["Takwir"], 82: ["Infitar"], 83: ["Mutaffifin", "Moutaffifine", "Les Fraudeurs"],
    84: ["Inshiqaq"], 85: ["Buruj", "Bourouj", "Les Constellations"], 86: ["Tariq", "Tariq"], 87: ["A'la", "Ala", "Le Très-Haut"],
    88: ["Ghashiya", "Ghachiya"], 89: ["Fajr", "L'Aube"], 90: ["Balad", "La Cité"], 91: ["Shams", "Chams", "Le Soleil"],
    92: ["Layl", "Lail", "La Nuit"], 93: ["Duha", "Douha", "Doha", "Le Jour montant"], 94: ["Sharh", "Charh", "Inshirah"],
    95: ["Tin", "Le Figuier"], 96: ["Alaq", "'Alaq", "L'Adhérence"], 97: ["Qadr", "La Destinée"], 98: ["Bayyina", "La Preuve"],
    99: ["Zalzala", "Zalzalah", "La Secousse"], 100: ["Adiyat", "'Adiyat"], 101: ["Qaria", "Qari'a"], 102: ["Takathur", "Takâthur"],
    103: ["Asr", "'Asr", "Le Temps"], 104: ["Humaza", "Houmaza"], 105: ["Fil", "L'Éléphant"], 106: ["Quraysh", "Quraish", "Qoraych"],
    107: ["Maun", "Ma'un", "L'Ustensile"], 108: ["Kawthar", "Kawsar", "Kaouthar", "L'Abondance"], 109: ["Kafirun", "Kafiroun", "Les Infidèles"],
    110: ["Nasr", "Le Secours"], 111: ["Masad", "Lahab", "Les Fibres"], 112: ["Ikhlas", "Ikhlâs", "Le Monothéisme pur"],
    113: ["Falaq", "L'Aube naissante"], 114: ["Nas", "Nâs", "Naas", "Les Hommes"],
}


def surah_by_name(name: str) -> Optional[int]:
    _, names = _quran()
    key = _name_key(name)
    if not key:
        return None
    if key in names:
        return names[key]
    return None


def verse_count(surah: int) -> Optional[int]:
    surahs, _ = _quran()
    return len(surahs[surah]["ayahs"]) if surah in surahs else None


def verse_text(surah: int, ayah: int) -> Optional[str]:
    surahs, _ = _quran()
    if surah not in surahs or not 1 <= ayah <= len(surahs[surah]["ayahs"]):
        return None
    return surahs[surah]["ayahs"][ayah - 1]


def surah_label(surah: int) -> str:
    surahs, _ = _quran()
    s = surahs[surah]
    return f"sourate {surah} {s['en']} ({s['name']})"


@lru_cache(maxsize=1)
def fiches() -> dict:
    return json.loads(FICHES.read_text(encoding="utf-8"))


# ----------------------------------------------------------------- finding references in a text
@dataclass
class HadithRef:
    book: str
    number: str
    start: int
    end: int


def hadith_refs(text: str) -> List[HadithRef]:
    """Collection + number pairs, in the order of the text: « al-Bukhârî (n°1) et Muslim (n°1907) »,
    « Muslim, hadith n°2999 », « le hadith n°777 du recueil d'al-Bukhârî », « (Bukhari) : 6018 »."""
    clean = re.sub(r"[*_`>]", " ", text or "")  # Markdown marks, same length: positions are kept
    books = [(m.start(), m.end(), m.lastgroup) for m in _BOOK_RE.finditer(clean)]
    numbers = []
    for m in _NUMBER_RE.finditer(clean):
        marked = m.group(1) is not None
        if re.search(r"(?:\bm\.|\bmort|\bd[ée]c[ée]d[ée]|\ben|\bvers|\bl'an|\bann[ée]e|\bsi[eè]cle)\s*\(?\s*$", fold(clean[max(0, m.start() - 12):m.start()])):
            continue  # a date (« al-Bukhârî, mort en 870 »), not a hadith number
        if not marked and re.search(r"(?:^|\n)[ \t]*$", clean[:m.start()]) and clean[m.end():m.end() + 1] in (".", ")"):
            continue
        numbers.append((m.start(), m.end(), m.group(1) or m.group(2), marked))
    refs, used_books = [], set()
    for start, end, value, marked in numbers:
        before = [b for b in books if b[1] <= start and start - b[1] <= 80]
        if marked and not before:
            # « Référence dans Sahîh al-Bukhârî : … il s'agit du hadith n°6116 » : the collection named in the same block
            block = clean.rfind("\n\n", 0, start)
            before = [b for b in books if max(block, start - 260) <= b[0] and b[1] <= start][-1:]
        # the books listed before a list of numbers are given in the same order (« Bukhârî et Muslim (n°1 et n°1907) »)
        if not marked:
            # a bare number counts only right after the collection: « Bukhari 6114 », « (Bukhari) : 6018 »
            before = [b for b in before if re.fullmatch(r"[\s,:()\-–|]*", clean[b[1]:start]) and start - b[1] <= 15]
        free = [b for b in before if b[0] not in used_books]
        book = None
        if before and re.fullmatch(r"[\s,:|\-–]*", clean[before[-1][1]:start]) and start - before[-1][1] <= 8:
            # « Il n'est pas dans Sahih Muslim. … - Abû Dâwûd n° 1452 » : the collection written just before the number
            book = before[-1]
        elif free:
            book = free[0]
        elif before and start - before[-1][1] <= 30:
            book = before[-1]
        elif marked:
            # « le hadith n°777 du recueil de l'imam al-Bukhârî », « n°4521 dans la classification de Sahih Muslim » :
            # same sentence, no other number, and not « … également rapporté par Muslim »
            after = [b for b in books if b[0] >= end and b[0] - end <= 60
                     and not re.search(r"[.!?;:\n\d]|[ée]galement|aussi|\bet\b|\bou\b", fold(clean[end:b[0]]))]
            book = after[0] if after else None
        if not book:
            continue
        used_books.add(book[0])
        if book[2] == "nawawi" and int(value) > 42:
            continue
        refs.append(HadithRef(book[2], str(int(value)), start, end))
    return refs


_QREF_RE = re.compile(r"(?<![\d:/.,])(\d{1,3})\s*:\s*(\d{1,3})(?:\s*(?:-|–|à|a)\s*(\d{1,3}))?(?![\d:/])")
_SURAH_VERSE_RE = re.compile(
    r"sourate\s+(?:n°\s*)?(?P<s>\d{1,3}|[\w'’ʿâîûéèà-]+(?:\s+[\w'’ʿâîûéèà-]+)?)[^.\n]{0,50}?\bversets?\s+(?P<a>\d{1,3})"
    r"(?:\s*(?:-|–|à|et)\s*(?P<b>\d{1,3}))?", re.I)
_VERSE_OF_SURAH_RE = re.compile(
    r"\bversets?\s+(?P<a>\d{1,3})(?:\s*(?:-|–|à|et)\s*(?P<b>\d{1,3}))?\s+de\s+la\s+sourate\s+(?:n°\s*)?"
    r"(?P<s>\d{1,3}|[\w'’ʿâîûéèà-]+(?:\s+[\w'’ʿâîûéèà-]+)?)", re.I)
_COUNT_RE = re.compile(r"(?:compte|contient|comporte|compos[ée]e?\s+de|a|avec|totalise|de)\s+(?:\*\*)?(\d{1,3})(?:\*\*)?\s+versets", re.I)
_SURAH_MENTION_RE = re.compile(r"(?:sourate|surah|sura)\s+(?:n°\s*)?(\d{1,3}|[\w'’ʿâîûéèà-]+(?:\s+[\w'’ʿâîûéèà-]+)?)", re.I)
_ARABIC_RUN_RE = re.compile(r"[\u0600-\u06ff][\u0600-\u06ff\u064b-\u065f\u0670\u06d6-\u06ed\s]{12,}[\u0600-\u06ff]")


def _surah_of(token: str) -> Optional[int]:
    token = token.strip(" *«»\"'()")
    if token.isdigit():
        n = int(token)
        return n if 1 <= n <= 114 else -n
    for size in (2, 1):
        part = " ".join(token.split()[:size])
        found = surah_by_name(part)
        if found:
            return found
    return None


@dataclass
class QuranRef:
    surah: int
    first: int
    last: int
    start: int
    end: int
    text: str


def quran_refs(text: str) -> List[QuranRef]:
    refs = []
    text = re.sub(r"[*_`>]", " ", text or "")  # Markdown marks (« le verset **2 de la sourate »), same length: positions are kept
    for m in _QREF_RE.finditer(text):
        surah, first, last = int(m.group(1)), int(m.group(2)), int(m.group(3) or m.group(2))
        window = fold(text[max(0, m.start() - 80): m.end() + 40])
        if not re.search(r"coran|qur|sourate|surah|verset|ayat|\bal-|\ban-|\bat-|\bas-|\bar-|baqara|\(", window):
            continue
        if not 1 <= surah <= 114 or first == 0:
            refs.append(QuranRef(surah, first, last, m.start(), m.end(), m.group(0)))
            continue
        refs.append(QuranRef(surah, first, last, m.start(), m.end(), m.group(0)))
    for regex in (_SURAH_VERSE_RE, _VERSE_OF_SURAH_RE):
        for m in regex.finditer(text):
            surah = _surah_of(m.group("s"))
            if not surah:
                continue
            first = int(m.group("a"))
            last = int(m.group("b") or first)
            if any(r.start <= m.start() < r.end or m.start() <= r.start < m.end() for r in refs):
                continue
            refs.append(QuranRef(surah, first, last, m.start(), m.end(), m.group(0)))
    return refs


def count_claims(text: str) -> List[Tuple[int, int, str]]:
    """(surah, number of verses claimed, sentence) for « la sourate X compte N versets »."""
    out = []
    for sentence in re.split(r"(?<=[.!?\n])\s+", text):
        counts = _COUNT_RE.findall(sentence)
        if not counts:
            continue
        mentions = [_surah_of(m) for m in _SURAH_MENTION_RE.findall(sentence)]
        mentions += [surah_by_name(m) for m in re.findall(r"\*\*([^*]{2,30})\*\*", sentence)]
        surahs = [s for s in mentions if s and s > 0]
        if len(set(surahs)) == 1:
            out.append((surahs[0], int(counts[0]), sentence.strip()))
    return out


# ----------------------------------------------------------------- before the answer
@dataclass
class Grounding:
    active: bool = False
    context: str = ""
    allowed: set = field(default_factory=set)  # (book, number) given to the model as verified
    fiche_refs: set = field(default_factory=set)  # (book, number) of the checked fiches given to the model
    facts: List[str] = field(default_factory=list)


def is_religious(text: str) -> bool:
    return bool(RELIGIOUS_RE.search(text or ""))


def _hadith_line(book: str, number: str, rows: List[dict]) -> str:
    row = rows[0]
    text = row.get("fr") or row.get("en") or ""
    grades = "; ".join(f"{g[1]} selon {g[0]}" for g in row.get("g") or [])
    grade = grades or ("recueil Sahih : authentique" if book in ("bukhari", "muslim") else "degré non indiqué dans la base")
    extra = f" ({len(rows)} versions sous ce numéro)" if len(rows) > 1 else ""
    return f"- {BOOKS[book]} n°{number}{extra} — {grade} — texte : « {text[:600]}{'…' if len(text) > 600 else ''} »"


def _quotes(text: str) -> List[str]:
    found = re.findall(r"«\s*([^»]{8,400})\s*»|\"([^\"]{8,400})\"|“([^”]{8,400})”", text)
    return [next(g for g in groups if g) for groups in found]


SOURCE_TALK_RE = re.compile(r"hadith|hadîth|coran|qur|sourate|surah|verset|ayat|sunna|proph[eè]te|ﷺ|حديث|سورة|آية|القرآن", re.I)


def prepare(question: str, code_request: bool = False, force: bool = False) -> Grounding:
    """The verified sources and rules given to the model for a question about Islam (force: a page where
    every question is about Islam). A code request that only mentions a religious word (« un script pour
    une mosquée ») is left as it is."""
    g = Grounding()
    if not force and (not is_religious(question) or (code_request and not SOURCE_TALK_RE.search(question))):
        return g
    g.active = True
    q = fold(question)
    lines: List[str] = []

    # fundamentals: the fiches whose words are in the question
    scored = []
    for fiche in fiches()["fiches"]:
        hits = sum(1 for word in fiche["mots"] if re.search(r"\b" + re.escape(fold(word)), q))
        if hits:
            scored.append((hits, fiche))
    for _, fiche in sorted(scored, key=lambda item: item[0], reverse=True)[:3]:
        lines.append(f"- [Fiche vérifiée] {fiche['texte']}")
        g.fiche_refs |= {(ref.book, ref.number) for ref in hadith_refs(fiche["texte"])}
    for item in fiches()["non_authentiques"]:
        if any(fold(word) in q for word in item["mots"]):
            lines.append(f"- [Parole non authentique, jugement documenté] {item['texte']}")

    # hadiths named by their number in the question
    for ref in hadith_refs(question):
        rows = hadith(ref.book, ref.number)
        if rows:
            lines.append(_hadith_line(ref.book, ref.number, rows))
            g.allowed.add((ref.book, ref.number))
        else:
            lines.append(f"- {BOOKS[ref.book]} n°{ref.number} : ce numéro N'EXISTE PAS dans la base "
                         f"({_book(ref.book)['numbering']}). Ne lui attribue aucun texte.")

    # hadiths quoted or described in the question: search in the 8 collections
    if HADITH_TALK_RE.search(question):
        queries = _quotes(question) or [question]
        named = tuple(m.lastgroup for m in _BOOK_RE.finditer(question))  # « c'est quel numéro chez Muslim ? »
        candidates = []
        for query in queries[:3]:
            candidates += search_hadith(query, limit=4, minimum=0.6 if query != question else 0.66, prefer=named)
        if candidates:
            for score, book, row in candidates[:4]:
                if (book, row["n"]) in g.allowed:
                    continue
                lines.append(_hadith_line(book, row["n"], [row]) + f" [correspondance des mots : {int(score * 100)} %]")
                g.allowed.add((book, row["n"]))
        elif _quotes(question):  # a precise text was looked for (a theme alone proves nothing)
            lines.append("- Recherche dans les 8 recueils de la base (Bukhârî, Muslim, Abû Dâwûd, Tirmidhî, Nasâ'î, Ibn Mâjah, "
                         "Muwatta', 40 d'an-Nawawî) : AUCUN hadith correspondant trouvé. Ne donne aucun numéro ni recueil : "
                         "dis que tu n'as pas trouvé de source vérifiée pour ce texte.")

    # Quran: references, surah names and Arabic text in the question
    for ref in quran_refs(question):
        lines.append(_quran_ref_line(ref))
    for mention in _SURAH_MENTION_RE.findall(question):
        surah = _surah_of(mention)
        if surah and surah > 0:
            lines.append(f"- {surah_label(surah)} : {verse_count(surah)} versets (texte Tanzil, comptage koufi).")
    lines += _question_quran_lines(question)
    quran_talk = re.search(r"coran|qur|sourate|surah|verset|ayat|سورة|آية|القرآن", question, re.I)
    for run in _ARABIC_RUN_RE.findall(question):
        if quran_talk or len(neura_quran.words(run)) >= 4 and neura_quran.check(run):
            lines.append(_arabic_line(run))  # an Arabic text of the Quran, or said to be one

    # fiqh: the recognised differences between the schools, the points of consensus
    for topic in fiqh_topics(question)[:3]:
        kind = "Consensus" if topic["statut"] == "consensus" else "Divergence entre les écoles"
        lines.append(f"- [{kind} — fiche vérifiée] {topic['sujet']} : {topic['texte']}")
    if any(re.search(p, fold(question)) for p in SCHOLARS.values()) or re.search(r"fatwa|avis d|mot pour mot", fold(question)):
        lines.append("- L'application n'a ni base de fatwas ni les ouvrages des savants : ne cite aucune fatwa, aucun numéro de fatwa "
                     "et aucune phrase « mot pour mot » d'un savant ou d'un organisme ; présente leur avis comme rapporté, à confirmer "
                     "dans leurs écrits ou auprès de la source officielle.")
    if personal_case(question):
        lines.append("- Situation personnelle complexe : donne les principes généraux et les avis des écoles, sans trancher le cas ; "
                     "recommande de soumettre la situation à un imam, un mufti ou un savant qualifié.")

    lines = list(dict.fromkeys(lines))
    g.facts = lines
    g.context = (
        "\n\nSOURCES VÉRIFIÉES PAR L'APPLICATION (Coran : texte de référence Tanzil ; hadiths : 8 recueils numérotés, "
        "Muslim selon la numérotation de Fu'âd ʿAbd al-Bâqî ; fiches relues) :\n"
        + ("\n".join(lines) if lines else "- (aucune source précise trouvée pour cette question)")
        + "\n\nRÈGLES DE FIABILITÉ RELIGIEUSE (une vérification automatique contrôle ta réponse) :\n"
        "1. N'écris un numéro de hadith que s'il figure ci-dessus ou si tu en es certain : chaque numéro est contrôlé "
        "dans la base après ta réponse, et un numéro faux est signalé et retiré. Dans le doute, cite le hadith sans "
        "numéro et dis que la référence exacte reste à vérifier ; ne devine jamais un recueil ni un rapporteur. "
        "Même sans numéro, « rapporté par Muslim » ou « le Prophète ﷺ a dit » est vérifié : n'attribue un texte à un "
        "recueil, ou au Prophète ﷺ, que si tu en es sûr ; sinon dis que la source est à vérifier.\n"
        "2. N'attribue jamais à un numéro ou à un recueil un texte différent de celui donné ci-dessus ; donne le degré "
        "d'authenticité tel qu'il est indiqué (avec le nom du savant), sans l'arranger.\n"
        "3. Coran : n'écris un numéro de verset, un nombre de versets ou un texte arabe que s'il est donné ci-dessus ou "
        "si tu en es absolument certain ; une traduction doit être présentée comme une traduction du sens, pas comme "
        "le texte du Coran. Quand une traduction de référence est donnée ci-dessus, reprends-la mot pour mot en nommant "
        "le traducteur (et QuranEnc.com) ; sinon dis que c'est une traduction approximative du sens. Ne présente jamais "
        "une paraphrase comme une citation, et vérifie que la phrase est bien celle du verset cité.\n"
        "4. Quand les écoles juridiques divergent, présente les avis en nommant les écoles ; un avis d'école n'est pas "
        "une règle pour tous. N'invente jamais un consensus, une fatwa, un numéro de fatwa ni une citation de savant ; "
        "un avis de savant non donné ci-dessus se présente comme rapporté, à confirmer.\n"
        "5. Si les sources ne permettent pas de répondre, dis-le clairement et indique comment vérifier.\n"
        "6. Réponds naturellement : ne parle pas de cette liste, de « données de référence », de « base de données » "
        "ni de « protocoles » ; cite simplement les sources (recueil, numéro, sourate:verset).\n"
        "7. Pour une situation personnelle (divorce, héritage, mariage…), donne les principes généraux et recommande de "
        "soumettre le cas à un savant qualifié ; ta réponse n'est jamais une fatwa.\n"
    )
    return g


def _quran_ref_line(ref: QuranRef) -> str:
    count = verse_count(ref.surah) if 1 <= ref.surah <= 114 else None
    if count is None:
        return f"- « {ref.text} » : la sourate {ref.surah} N'EXISTE PAS (le Coran compte 114 sourates)."
    if ref.first > count or ref.last > count:
        return (f"- « {ref.text} » : ce verset N'EXISTE PAS : la {surah_label(ref.surah)} compte {count} versets.")
    verses = [verse_text(ref.surah, a) for a in range(ref.first, min(ref.last, ref.first + 4) + 1)]
    french = [neura_quran_fr.translation(ref.surah, a) for a in range(ref.first, min(ref.last, ref.first + 4) + 1)]
    translated = (f" — traduction du sens ({neura_quran_fr.attribution()}) : « {' / '.join(french)} »"
                  if all(french) else "")
    return (f"- Coran {ref.surah}:{ref.first}{'-' + str(ref.last) if ref.last != ref.first else ''} ({surah_label(ref.surah)}, "
            f"{count} versets) — texte arabe exact (Tanzil, sans voyelles) : « {' '.join(verses)} »{translated}")


def _arabic_line(run: str) -> str:
    result = neura_quran.check(run)
    if not result:
        return f"- Texte arabe « {run[:80]} » : NON TROUVÉ dans le Coran par la vérification mot à mot (ce n'est pas un passage du Coran, ou il est trop modifié pour être situé)."
    verses = (f"verset {result['ayah_start']}" if result["ayah_start"] == result["ayah_end"]
              else f"versets {result['ayah_start']} à {result['ayah_end']}")
    where = f"{surah_label(result['surah'])}, {verses}"
    if result["identical"]:
        return f"- Texte arabe cité : mots IDENTIQUES au Coran — {where} (les voyelles ne sont pas comparées)."
    diffs = "; ".join(_diff_text(d) for d in result["diffs"])
    return f"- Texte arabe cité : NON EXACT — il correspond à {where}, avec ces différences : {diffs}. Dis-le clairement."


def _diff_text(diff: dict) -> str:
    if diff["kind"] == "remplacé":
        return f"verset {diff['ayah']} : « {diff['image']} » au lieu de « {diff['quran']} »"
    if diff["kind"] == "manquant":
        return f"verset {diff['ayah']} : il manque « {diff['quran']} »"
    return f"verset {diff['ayah']} : « {diff['image']} » a été ajouté"


# ----------------------------------------------------------------- after the answer
@dataclass
class Finding:
    level: str          # "ok", "warn" or "error"
    kind: str           # "hadith", "coran", "texte coranique", "versets"
    message: str
    span: Optional[Tuple[int, int]] = None  # where the reference is in the answer
    fix: Optional[str] = None  # what replaces the span when the error remains (default: the reference is removed)


_QUOTE_RE = re.compile(r"«\s*([^»]{6,600})\s*»|“([^”]{6,600})”|\"([^\"]{6,600})\"")


def _claims(text: str, start: int, question: str = "", previous_end: int = 0) -> List[str]:
    """What the answer attributes to a reference: the quotation just before it (not one that belongs to the
    previous reference), else the next quotation, else the words of the sentence that lead to it; the
    quotation of the question only when the answer quotes nothing."""
    para_start = text.rfind("\n\n", 0, start) + 1
    para_end = text.find("\n\n", start)
    para_end = len(text) if para_end < 0 else para_end
    floor = max(para_start, previous_end)
    out = []
    line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", start)
    line = text[line_start: len(text) if line_end < 0 else line_end]
    if "|" in line and not _QUOTE_RE.search(line):
        table_start = line_start
        while table_start > 0:
            previous_line = text.rfind("\n", 0, table_start - 1) + 1
            if "|" not in text[previous_line:table_start]:
                break
            table_start = previous_line
        before_table = list(_QUOTE_RE.finditer(text[max(0, table_start - 1500):table_start]))
        if before_table:
            out.append(next(g for g in before_table[-1].groups() if g))
    before = list(_QUOTE_RE.finditer(text[floor:start]))
    if before:
        out.append(next(g for g in before[-1].groups() if g))
    after = [] if before else list(_QUOTE_RE.finditer(text[start:start + 1500]))
    if after:  # « Références : Bukhârî n°…, Muslim n°… » then « Texte : « … » » further down
        out.append(next(g for g in after[0].groups() if g))
    if not before and not after:
        sentence_start = max(text.rfind(". ", floor, start), text.rfind("\n", floor, start), floor)
        clause = text[sentence_start:start]  # « Celui qui mange par oubli continue son jeûne (Muslim n°1155) »
        if len(content_words(clause)) < 2:
            # « *Source : rapporté par Muslim (n°8).* » : what was said just before is what is attributed
            clause = text[max(0, start - 400):start]
        out.append(clause)
        out += _quotes(question)
    return out


_NARRATOR_RE = re.compile(r"rapport[ée]\s+par\s+(?:le\s+compagnon\s+|la\s+compagne\s+)?\*{0,2}([^*,.;:()\n—-]{3,40})", re.I)


def _narrator_ok(answer: str, start: int, rows: List[dict]) -> Optional[str]:
    """None if fine (or nothing to compare); otherwise what the base says. The names are looked for among the
    proper names of the beginning of each version (the hadith of Jibril, Muslim 8, starts with Yahya ibn Yaʿmur
    before ʿUmar tells it)."""
    row = rows[0]
    para_start = answer.rfind("\n\n", 0, start) + 1
    near = answer[para_start: start + 200]
    found = list(_NARRATOR_RE.finditer(near))
    if not found:
        return None
    claim = found[-1].group(1)
    if near[found[-1].end(1): found[-1].end(1) + 1] == "-":
        claim = near[found[-1].start(1): found[-1].end(1) + 16]  # « l'imam Al-Bukhari » was cut at the hyphen
    if re.search(r"bukh|boukh|muslim|tirmidh|nasa|dawud|daoud|majah|malik|ahmad|bayhaq|hakim|tabaran", fold(claim)):
        return None  # "rapporté par al-Bukhârî": a collection, not a narrator
    names = []
    for version in rows:
        names += re.findall(r"[A-ZʿʾÀ-Ý`'’][\w`'’ʿʾ-]{2,}", (version.get("fr") or "")[:700] + " " + (version.get("en") or "")[:700])
    tokens = [_skeleton(t) for t in re.findall(r"[a-z]{3,}", fold(claim)) if t not in ("ibn", "bin", "abu", "abou", "umm", "oum")]
    tokens = [t for t in tokens if len(t) >= 2]
    head_skeletons = {_skeleton(t) for name in names for t in re.findall(r"[a-z]{3,}", fold(name))}
    if not tokens:
        def plain(t: str) -> str:
            return fold(t).replace("ch", "sh").replace("ou", "u").replace("'", "")
        raw = [plain(t) for t in re.findall(r"[a-z']{4,}", fold(claim)) if t not in ("ibn", "bint", "abou", "umm")]
        heads = {plain(t) for name in names for t in re.findall(r"[a-z']{3,}", fold(name))}
        if not raw or any(t in heads or t.rstrip("h") in heads for t in raw):
            return None
    elif any(t in head_skeletons for t in tokens):
        return None
    m = re.match(r"\s*(?:rapport[ée] par|narrated|it was narrated (?:from|that)|it is narrated on the authority of)?\s*([^:]{3,80})", row.get("fr") or row.get("en") or "", re.I)
    return (m.group(1).strip() if m else "un autre compagnon")


def _short(text: str, size: int = 60) -> str:
    text = re.sub(r"\s+", " ", text or "").strip().replace(" : ", ": ")
    return text if len(text) <= size else text[:size].rsplit(" ", 1)[0] + "…"


def _sentence(text: str, start: int, end: int) -> str:
    """The sentence (or list line) around a span."""
    head = max(text.rfind(". ", 0, start), text.rfind("\n", 0, start), text.rfind("? ", 0, start), text.rfind("! ", 0, start)) + 1
    tails = [i for i in (text.find(". ", end), text.find("\n", end), text.find("? ", end), text.find("! ", end)) if i >= 0]
    return text[head: (min(tails) + 1) if tails else len(text)]


def _quote_core(text: str) -> str:
    """A quotation without what is in brackets (« (as-sabru 'inda as-sadmatil-ûlâ) », « (Al-Hayâ') »): a
    transliteration or an explanation, not the words of the hadith."""
    return re.sub(r"\([^()]{0,120}\)|\[[^\[\]]{0,120}\]", " ", text or "")


def _latin_words(text: str) -> List[str]:
    return [w for w in content_words(_quote_core(text)) if re.fullmatch(r"[a-z]+", w)]


_HEDGE_RE = re.compile(r"a verifier|non verifi|non confirm|pas pu (?:etre )?verifi|incertain|pas certain|sans certitude|"
                       r"pas authentique|non authentique|sans source|source (?:non|pas|a)|en substance|sens general|paraphrase|"
                       r"proche de|approximati|attribution non|il se peut|il est possible que|reste a confirmer|a confirmer")


# ----------------------------------------------------------------- hadiths attributed WITHOUT a number
# Collections that are not in the base: an attribution to them cannot be checked here.
OTHER_BOOKS_RE = re.compile(r"\bmusnad\b|\bimam ahmad\b|bayhaq[iîy]|tabar[aâ]n[iîy]|mustadrak|al-?h[aâ]kim\b|ibn hibb[aâ]n|d[aâ]rim[iîy]\b|"
                            r"d[aâ]raqutn[iîy]|ibn khuzayma|ab[uoû]+ ya['ʿ]?l[aâ]|bazz[aâ]r|ibn ab[iî] shayba|['ʿ]?abd ar-?razz[aâ]q", re.I)
_NEG_ATTR_RE = re.compile(r"n'est pas (?:rapport|dans|chez|cit|mentionn|present|de )|ne figure pas|ne se trouve pas|pas dans|pas chez|"
                          r"introuvable|non retrouv|n'existe pas|ne contien|\baucun|pas rapport|faussement|a tort|\bni\b|pas (?:attest|connu)|"
                          r"ne l'a pas|absent|ne rapporte pas|sans fondement|pas sous cette forme|n'est pas le texte|pas (?:le|un) texte litteral|"
                          r"pas litteral|pas mot pour mot|formulation (?:precise |exacte )?(?:n'est pas|differ|ne figure)|"
                          r"n'est pas etabli|pas etablie|n'est pas (?:une parole|authentique)|pas une parole|ne provient pas|\bnon (?:par|dans|chez)\b")
_SAYING_RE = re.compile(r"(?:proph[eè]te|messager)[^.\n«]{0,60}?(?:a dit|disait|a declare|a affirme|a enseigne|a recommande|dit)\s*:?\s*$")


@lru_cache(maxsize=1)
def _all_texts() -> Tuple[str, ...]:
    """One hadith in five of the 8 collections: enough to know how common a word is, five times faster."""
    return tuple(row["k"] for book in BOOKS for versions in _book(book)["by_n"].values() for row in versions)[::5]


@lru_cache(maxsize=4096)
def _rarity(word: str) -> float:
    """How rare a word is in the 8 collections: « colère » tells which hadith is meant, « sera » does not."""
    rows = _all_texts()
    found = sum(1 for k in rows if _present(word, k))
    return math.log((len(rows) + 1) / (found + 1)) + 0.1


def _rare_found(words: List[str], haystack: str, size: int = 3) -> int:
    """How many of the rarest words of a quotation are in a text (« palmier », « palais » — not « paradis »)."""
    rare = sorted(dict.fromkeys(words), key=_rarity, reverse=True)[:size]
    return sum(1 for w in rare if _present_loose(w, haystack))


def _close(a: str, b: str) -> bool:
    """One or two letters of difference (conjugation, spelling): « dise » / « dire », « taise » / « taire »."""
    if a[:2] != b[:2] or abs(len(a) - len(b)) > 2 or min(len(a), len(b)) < 4:
        return False
    limit = 1 if min(len(a), len(b)) <= 5 else 2
    if limit == 2 and a[:3] != b[:3]:
        return False
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1] <= limit


def _present_loose(word: str, haystack: str) -> bool:
    return _present(word, haystack) or any(_close(word, token) for token in set(haystack.split()))


def _weighted(words: List[str], haystack: str) -> float:
    words = list(dict.fromkeys(words))
    total = sum(_rarity(w) for w in words)
    return sum(_rarity(w) for w in words if _present_loose(w, haystack)) / total if total else 0.0


@lru_cache(maxsize=256)
def _search_cached(text: str, limit: int, minimum: float, books: Tuple[str, ...] = ()) -> Tuple:
    """The hadiths that contain the words of a quotation, scored by the rare words they share with it."""
    text = _quote_core(text)
    words = _latin_words(text) or content_words(text)
    found = search_hadith(text, max(limit, 8), minimum, prefer=("bukhari", "muslim"), books=books)
    def score(plain: float, row: dict) -> float:
        weighted = _weighted(words, row["k"])
        # a long quotation is told by all its words (its rare words may be translated differently)
        return round(weighted if len(set(words)) < 8 else max(weighted, (plain + weighted) / 2), 2)
    if len(set(words)) <= 8:
        found = [c for c in found if _rare_found(words, c[2]["k"]) >= min(2, len(set(words)) - 1)]
    scored = sorted(((score(plain, row), book, row) for plain, book, row in found),
                    key=lambda c: (c[0], c[1] in ("bukhari", "muslim"), -len(c[2]["k"])), reverse=True)
    return tuple(scored[:limit])


def _outer_quotes(text: str) -> List[Tuple[int, int, str]]:
    """Quotations, a quotation inside another one counted with it (« Il a dit : « … » »)."""
    out, depth, begin = [], 0, 0
    for i, ch in enumerate(text):
        if ch == "«":
            if depth == 0:
                begin = i
            depth += 1
        elif ch == "»" and depth:
            depth -= 1
            if depth == 0 and i - begin > 6:
                out.append((begin, i + 1, text[begin + 1:i].strip()))
    for m in re.finditer(r"“([^”]{6,600})”|\"([^\"]{6,600})\"", text):
        if not any(s <= m.start() < e for s, e, _ in out):
            out.append((m.start(), m.end(), next(g for g in m.groups() if g)))
    return sorted(out)


REMOVED_SAYING = "[parole retirée : aucune source suffisante ne confirme son attribution au Prophète ﷺ]"
# The answer itself says that the text is not an authentic saying: it is quoted to be corrected, not attributed.
_NOT_AUTHENTIC_RE = re.compile(r"n'est pas (?:un hadith|authentique|une parole|etabli)|pas authentique|non authentique|faible|da'?if|forg|"
                               r"invent|mawdu|n'existe pas|aucune source|sans fondement|aucun hadith|pas (?:de|une) parole du proph|"
                               r"faussement attribu|n'a jamais dit|pas un hadith|introuvable")


@lru_cache(maxsize=1)
def _other_languages(book: str) -> Dict[str, List[Tuple[str, str]]]:
    """{number: [(English words, Arabic words)]} of one collection, read only when an attribution needs it (two
    one collection at a time in memory): the same hadith is recognised in another translation or in Arabic."""
    with gzip.open(DATA / "hadiths" / f"{book}.json.gz", "rt", encoding="utf-8") as handle:
        doc = json.load(handle)
    out: Dict[str, List[Tuple[str, str]]] = {}
    for row in doc["hadiths"]:
        arabic = " " + " ".join(neura_quran.words(row.get("ar") or "")) + " "
        out.setdefault(row["n"], []).append((_words_text(row.get("en") or ""), arabic))
    return out


def _arabic_words(text: str) -> List[str]:
    return list(dict.fromkeys(neura_quran.words(text)))


def _other_language_match(text: str, book: str) -> Optional[Tuple[float, str]]:
    """(score, number): the quotation found in the English or Arabic text of the collection. Arabic: the words of the
    quotation, in order of the hadith, at least 5 of them; English: the usual equivalents of the French words."""
    arabic = _arabic_words(text)
    latin = list(dict.fromkeys(_latin_words(text)))
    rarest = max(latin, key=_rarity) if latin else ""
    span = max(160, int(2.5 * len(text)))
    best: Optional[Tuple[float, str]] = None
    for number, versions in _other_languages(book).items():
        for english, ar in versions:
            score = 0.0
            if len(arabic) >= 5 and ar.strip():
                score = sum(1 for w in arabic if f" {w} " in ar) / len(arabic)
            elif len(latin) >= 4 and english.strip():
                hits = sum(1 for w in latin if _present(w, english))
                if hits >= 3 and hits / len(latin) >= 0.75 and _present(rarest, english) and _local(latin, english, span):
                    score = hits / len(latin)
            if score and (best is None or score > best[0]):
                best = (round(score, 2), number)
    return best


def _removal_span(clean: str, quote: Tuple[int, int], mention: Optional[Tuple[int, int]]) -> Tuple[int, int]:
    """The quotation, with the collection written right next to it (« « … » (Muslim) » goes with it)."""
    start, end = quote
    intro = re.search(r"(?:\b[Ll]e |\b[Ll]')?(?:[Pp]roph[eè]te|[Mm]essager(?: d['’]Allah)?)[^.\n«»]{0,60}?(?:a dit|disait|a déclaré|"
                      r"a affirmé|a enseigné|a recommandé|dit)\s*:?\s*$", clean[max(0, start - 120):start])
    if intro:
        start = max(0, start - 120) + intro.start()
    if mention:
        if 0 <= mention[0] - end <= 40 and not re.search(r"[«»\n]", clean[end:mention[0]]):
            closing = re.match(r"[^\n.()]*\)", clean[mention[1]:mention[1] + 40])
            end = mention[1] + (closing.end() if closing and "(" in clean[end:mention[0]] else 0)
        elif 0 <= start - mention[1] <= 40 and not re.search(r"[«»\n]", clean[mention[1]:start]):
            start = mention[0]
    return start, end


def _attributed_quote(clean: str, start: int, end: int, quotes: list, hrefs: List[HadithRef]):
    """The quotation a collection named without a number is about: « … » (Muslim), or « rapporté par Muslim : « … » »."""
    def free(a: int, b: int) -> bool:
        # « Abû Dâwûd (n°61) et at-Tirmidhî » : a numbered reference listed just before is about the same quotation
        return not any(a <= r.start < b and start - r.end > 20 for r in hrefs)

    def close_before(q) -> bool:
        between = clean[q[1]:start]
        if _BOOK_RE.search(between[:max(0, len(between) - 25)]) or OTHER_BOOKS_RE.search(between[:max(0, len(between) - 25)]):
            return False  # « « … » (Rapporté par Ibn Majah). Conseil : … Sahih Muslim » : the quotation belongs to Ibn Majah
        return "\n\n" not in between or len(re.findall(r"[^\W\d_]{3,}", between)) <= 12
    before = [q for q in quotes if q[1] <= start and start - q[1] <= 300 and free(q[1], start) and close_before(q)]
    after = [q for q in quotes if q[0] >= end and q[0] - end <= 250 and free(end, q[0])
             and ("\n\n" not in clean[end:q[0]] or clean[end:q[0]].split("\n\n")[0].rstrip().endswith(":"))]
    if before and (start - before[-1][1] <= 60 or not after):
        return before[-1]
    return after[0] if after else None


def _hadith_quote(text: str) -> bool:
    """A quotation that can be a hadith: French words, or a long enough Arabic text that is not the Quran."""
    if len(_latin_words(text)) >= 3:
        return True
    arabic = _arabic_words(text)
    return len(arabic) >= 5 and not neura_quran.check(text)


def _unnumbered(answer: str, hrefs: List[HadithRef], qrefs: List["QuranRef"], question: str) -> List[Finding]:
    """« Le Prophète ﷺ a dit : « … » (rapporté par Muslim) »: the text is looked for in the collection named, in
    French, then in English and Arabic. Six cases, from the least to the most serious:
    1. found as it is -> confirmed;  2. found worded differently (another translation) -> confirmed, never rejected;
    3. found in another collection only -> the reference is corrected when the match is reliable, otherwise flagged;
    4. not enough to decide -> flagged « not confirmed »;  5. found nowhere -> an invented saying: it is removed
    from the answer (never kept as a hadith, even with a warning);  6. graded weak and called authentic -> corrected."""
    clean = re.sub(r"[*_`>|]", " ", answer)
    quotes = [q for q in _outer_quotes(clean) if _hadith_quote(q[2])]
    mentions = [(m.start(), m.end(), m.lastgroup) for m in _BOOK_RE.finditer(clean)]
    mentions += [(m.start(), m.end(), "autre") for m in OTHER_BOOKS_RE.finditer(clean)]
    out, done, attributed = [], set(), set()
    for start, end, book in sorted(mentions):
        if any(r.book == book and (0 <= r.start - end <= 120 or 0 <= start - r.end <= 60) for r in hrefs) \
                or any(0 <= r.start - end <= 40 for r in hrefs):
            continue  # a numbered reference: checked with its number
        sentence = fold(_sentence(clean, start, end))
        # a list of collections (« Sahih Muslim, Sunan Abû Dâwûd, Sunan Ibn Mâjah ») shares what is said before it
        first = start
        for m_start, m_end, _ in sorted(mentions, reverse=True):
            if m_end <= first and re.fullmatch(r"[\s,;()]*(?:et|ou|ni)?[\s,;()]*(?:sunan|sahih|le|la|al-|du)?[\s]*", fold(clean[m_end:first])):
                first = m_start
        head = max([m[1] for m in mentions if m[1] <= first and first - m[1] <= 120] + [first - 120, 0])
        sentence_head = max(clean.rfind(". ", 0, first), clean.rfind("\n", 0, first)) + 1
        clause = fold(clean[max(head, sentence_head): end + 25])
        quote = _attributed_quote(clean, start, end, quotes, hrefs)
        if quote and any(abs(r.start - quote[0]) < 150 or abs(r.start - quote[1]) < 150 for r in qrefs):
            quote = None  # a verse of the Quran
        if quote:
            text, where = quote[2], (quote[0], quote[1])
            attributed.add(quote[0])
        else:
            asked = [q for q in _quotes(question) if len(_latin_words(q)) >= 3]
            if not asked or not re.search(r"ce hadith|cette parole|ce texte|cette phrase|se trouve|figure|rapport|recueil", sentence):
                continue
            text, where = asked[0], None
        key = (book, fold(text)[:80])
        if key in done:
            continue
        done.add(key)
        words = _latin_words(text)
        arabic = len(words) < 3  # an Arabic quotation
        name = BOOKS.get(book) or clean[start:end].strip()
        label = f"{name} (sans numéro) — « {_short(text, 50)} »"
        around = _sentence(clean, start, end) + (" " + clean[max(0, where[0] - 150):where[0]] + " " + clean[where[1]:where[1] + 150] if where else "")
        context = fold(around)
        hedged = bool(_HEDGE_RE.search(context))
        corrected_by_answer = bool(_NOT_AUTHENTIC_RE.search(context))
        negative = bool(_NEG_ATTR_RE.search(clause))
        if book == "autre":
            if not negative:
                out.append(Finding("warn", "attribution", f"{label} : recueil absent de la base de l'application, attribution "
                                   "non vérifiable automatiquement (non confirmée).", (start, end)))
            continue
        named = () if arabic else _search_cached(text, 3, 0.3, (book,))
        best_named = named[0][0] if named else 0.0
        number = named[0][2]["n"] if named else None
        other_language = None
        if arabic or 0.3 <= best_named < 0.6 or (not named and _book(book)["fr_share"] < 0.5):
            other_language = _other_language_match(text, book)  # one collection in memory at a time, only when useful
            if other_language and other_language[0] >= (0.6 if arabic else 0.75) and other_language[0] > best_named:
                best_named, number = other_language[0], other_language[1]  # the same hadith in English or Arabic
        if negative:
            if best_named >= 0.85 and (len(words) >= 4 or arabic):
                out.append(Finding("warn", "attribution", f"{label} : la réponse dit que ce texte n'est pas dans ce recueil, "
                                   f"mais un texte très proche y figure (n°{number}) : à vérifier.", (start, end)))
            continue
        other = None if arabic else next((c for c in _search_cached(text, 4, 0.5) if c[1] != book), None)
        short = len(set(words)) <= 5
        rare_named = _rare_found(words, named[0][2]["k"]) if named else 0
        fix, span, kind = None, (start, end), "attribution"
        via = " (texte anglais ou arabe de la base)" if other_language and number == other_language[1] and best_named == other_language[0] else ""
        if best_named >= 0.6 and not arabic and len(words) < 4 and best_named < 0.99:
            level, message = "warn", f"texte trop court pour confirmer (le plus proche : n°{number}) : attribution non confirmée"
        elif best_named >= 0.6 and short and best_named < 0.85 and other and other[0] >= best_named + 0.25:
            level = "warn"  # a short text: one word missing may be another hadith, or another translation
            message = (f"attribution non confirmée : ce texte ne se trouve pas dans ce recueil sous cette forme ; il correspond à "
                       f"{BOOKS[other[1]]} n°{other[2]['n']} (« {_short(other[2].get('fr') or other[2].get('en') or '', 90)} »)")
        elif best_named >= 0.6:
            rows = [c[2] for c in named if c[0] >= best_named - 0.1] or hadith(book, number)
            level, message = "ok", (f"référence correcte, trouvé dans ce recueil (n°{number}){via}" if best_named >= 0.85 else
                                    f"même hadith, formulation différente de la traduction de la base (n°{number}){via}")
            other_narrator = _narrator_ok(clean, start, rows) if rows else None
            if other_narrator:
                level, message = "warn", (f"trouvé dans ce recueil (n°{number}), mais le rapporteur indiqué n'apparaît pas dans "
                                          f"cette version (la base indique « {_short(other_narrator, 50)} ») : à vérifier")
            row = rows[0] if rows else {}
            grades = [fold(g[1]) for g in row.get("g") or []]
            if grades and all(re.search(r"da'?if|daif|munkar|mawdu|fabricat", g) for g in grades) and \
                    re.search(r"authentique|sahih", context) and not _has_authentic_version(text, best_named):
                level = "error"
                graded = "; ".join(f"{g[1]} ({g[0]})" for g in row["g"][:3])
                message = f"hadith faible présenté comme authentique (n°{number}) : la base le classe {graded}"
                if where:
                    span, fix = (where[1], where[1]), f" [ce hadith est classé faible dans la base : {graded}]"
        elif other and other[0] >= 0.6 and other[0] >= best_named + 0.25:
            real = _short(other[2].get("fr") or other[2].get("en") or "", 90)
            rarest = max(dict.fromkeys(words), key=_rarity) if words else ""
            missing_key = bool(rarest) and (not named or not _present_loose(rarest, named[0][2]["k"])) \
                and _present_loose(rarest, other[2]["k"])
            # reliable only when the collection named has (nearly) nothing of it and the other one has nearly all of it:
            # the translations of the base differ from one collection to another
            reliable = other[0] >= 0.75 and (best_named < 0.35 or (best_named < 0.55 and missing_key))
            if reliable:
                level, fix = "error", f"{BOOKS[other[1]]} (n°{other[2]['n']}) [référence corrigée]"
                prefix = re.search(r"(?:(?:sahih|sunan|l'imam|imam)\s+)?(?:al|an|at|as|el)[-‑\s]?$", clean[max(0, start - 14):start], re.I)
                if prefix:
                    span = (start - (len(clean[max(0, start - 14):start]) - prefix.start()), end)
                message = (f"mauvais recueil : ce texte ne se trouve pas dans ce recueil ; il correspond à {BOOKS[other[1]]} "
                           f"n°{other[2]['n']} (« {real} »)")
            else:
                level = "warn"
                message = (f"attribution non confirmée : formulation absente de ce recueil, texte plus proche : {BOOKS[other[1]]} "
                           f"n°{other[2]['n']} (« {real} »)"
                           + (f" ; le plus proche dans ce recueil est le n°{named[0][2]['n']}, formulé autrement" if best_named >= 0.3 else ""))
        elif (best_named >= 0.4 and len(set(words)) > 8) or (best_named >= 0.5 and rare_named >= 2) or \
                (other_language and other_language[0] >= 0.5):
            level, message = "warn", f"attribution non confirmée : correspondance partielle avec le n°{number or other_language[1]} de ce recueil"
            if other and other[0] > best_named:
                message += f" (texte plus proche : {BOOKS[other[1]]} n°{other[2]['n']})"
        elif not arabic and len(words) >= 4 and _book(book)["fr_share"] >= 0.5 and not (other and other[0] >= 0.6) \
                and not corrected_by_answer and not _search_cached(text, 1, 0.5):
            # found in none of the 8 collections, in French, English or Arabic: not kept as a saying of the Prophet ﷺ
            level, kind = "error", "invention"
            message = ("parole introuvable dans les 8 recueils de la base (français, anglais, arabe) : elle ne doit pas "
                       "être présentée comme un hadith")
            if where:
                span, fix = _removal_span(clean, where, (start, end)), REMOVED_SAYING
            else:
                fix = answer[start:end] + " [attribution non confirmée : texte introuvable dans ce recueil]"
        elif arabic and len(_arabic_words(text)) >= 6:
            level, message = "warn", "attribution non confirmée : ce texte arabe n'a pas été retrouvé dans ce recueil"
        else:
            level, message = "warn", "attribution non confirmée par la base (texte non retrouvé, ou recueil surtout en anglais)"
        if hedged and level == "error" and kind == "attribution" and "mauvais recueil" in message:
            level = "warn"  # the answer already says the collection is to be checked
        out.append(Finding(level, kind, f"{label} : {message}.", span, fix=fix))

    # « Le Prophète ﷺ a dit : « … » » with no collection at all
    for start, end, text in quotes:
        if start in attributed or not _SAYING_RE.search(fold(clean[max(0, start - 120):start])):
            continue
        if any(abs(m[0] - start) < 300 or abs(m[0] - end) < 300 for m in mentions) \
                or any(abs(r.start - start) < 300 or abs(r.start - end) < 300 for r in hrefs) \
                or any(abs(r.start - start) < 200 or abs(r.start - end) < 200 for r in qrefs):
            continue
        words = _latin_words(text)
        if len(words) < 4:
            continue
        found = _search_cached(text, 1, 0.4)
        label = f"Parole du Prophète ﷺ — « {_short(text, 50)} »"
        context = fold(clean[max(0, start - 200): end + 200])
        if found and found[0][0] >= 0.6:
            out.append(Finding("ok", "parole", f"{label} : trouvée dans {BOOKS[found[0][1]]} n°{found[0][2]['n']}.", (start, end)))
        elif _NOT_AUTHENTIC_RE.search(context):
            continue  # the answer says it is not an authentic saying: quoted to be corrected
        elif (not found or found[0][0] < 0.5) and len(words) >= 5:
            # not in the 8 collections: removed, even if the answer adds « à vérifier »
            out.append(Finding("error", "invention", f"{label} : parole introuvable dans les 8 recueils de la base ; elle ne doit pas "
                               "être présentée comme une parole du Prophète ﷺ.", _removal_span(clean, (start, end), None),
                               fix=REMOVED_SAYING))
        else:
            near = f" (le plus proche : {BOOKS[found[0][1]]} n°{found[0][2]['n']})" if found else ""
            out.append(Finding("warn", "parole", f"{label} : non retrouvée telle quelle dans les 8 recueils de la base, "
                               f"attribution non confirmée{near}.", (start, end)))
    return out


# ----------------------------------------------------------------- French translations of the Quran (QuranEnc)
# Words of the translations that do not tell which verse is meant.
QSTOP = set("""certes soyez soit sois ceux celles car point nulle nul voici ainsi vraiment quiconque lorsque afin dis
leurs eux sera seront etes etait furent avez avons ont avait ete fut ceci cela vers chose choses rien jamais toujours
deja encore peu part""".split())
_QNEG_RE = re.compile(r"pas exact|inexact|alter|au lieu|ne dit pas|ne correspond pas|errone|fausse|\bfaux\b|incorrect|"
                      r"que tu cites|que vous citez|ta citation|votre citation|ta phrase|votre phrase|"
                      r"n'est pas (?:la traduction|dans|le verset|tire)|ne figure pas|ne se trouve pas|confusion|confond|ne s'agit pas")
_QURAN_INTRO_RE = re.compile(r"allah (?:dit|a dit|declare|affirme)|(?:dit|declare) allah|le coran (?:dit|enonce)|dans le coran|"
                             r"parole d'allah|exalte soit-il|qu'il soit exalte|tres-haut dit|le verset (?:dit|suivant)|verset :")


def _qwords(text: str) -> List[str]:
    words = re.findall(r"[a-z]+", fold(text))
    return list(dict.fromkeys(w for w in words if len(w) > 2 and w not in STOP and w not in QSTOP))


@lru_cache(maxsize=1)
def _fr_verses() -> Tuple[List[Tuple[int, int, str]], Dict[Tuple[int, int], int]]:
    """(surah, verse, folded words of the two translations): compared, never shown."""
    rashid, montada = neura_quran_fr.verses("rashid"), neura_quran_fr.verses("montada")
    rows, index = [], {}
    for key in sorted(set(rashid) | set(montada)):
        text = neura_quran_fr.for_comparison(rashid.get(key, "")) + " " + neura_quran_fr.for_comparison(montada.get(key, ""))
        index[key] = len(rows)
        rows.append((key[0], key[1], _words_text(text)))
    return rows, index


def _hits(words: List[str], haystack: str) -> set:
    return {w for w in words if _present(w, haystack)}


def _cited_text(surah: int, first: int, last: int) -> str:
    rows, index = _fr_verses()
    return " " + " ".join(rows[index[(surah, a)]][2] for a in range(first, min(last, first + 15) + 1) if (surah, a) in index) + " "


def verse_cover(words: List[str], surah: int, first: int, last: int) -> float:
    """Part of the words of a French quotation found in the two translations of the verses cited (« mêlez » is
    found in « mêler », « cachez » in « cacher »)."""
    text = _cited_text(surah, first, last)
    return sum(1 for w in words if _present_loose(w, text)) / len(words) if words else 0.0


def _missing(words: List[str], surah: int, first: int, last: int) -> List[str]:
    text = _cited_text(surah, first, last)
    return [w for w in words if not _present_loose(w, text)]


def best_verses(words: List[str], exclude: frozenset = frozenset(), limit: int = 1) -> List[Tuple[float, int, int, int]]:
    """(score, surah, first, last): the verses — or two following verses — whose translations contain most of the words."""
    if len(words) < 2:
        return []
    rows, _ = _fr_verses()
    scored = []
    previous = (None, None, set())
    for surah, ayah, text in rows:
        hits = _hits(words, text)
        if len(hits) >= 2 and (surah, ayah) not in exclude:
            scored.append((len(hits) / len(words), surah, ayah, ayah))
        p_surah, p_ayah, p_hits = previous
        if len(words) >= 6 and p_surah == surah and hits and p_hits and (surah, ayah) not in exclude and (surah, p_ayah) not in exclude:
            union = hits | p_hits
            if len(union) > max(len(hits), len(p_hits)):
                scored.append((len(union) / len(words) - 0.01, surah, p_ayah, ayah))  # one verse first on equal scores
        previous = (surah, ayah, hits)
    scored.sort(key=lambda item: item[0], reverse=True)
    return [(round(score, 2), s, a, b) for score, s, a, b in scored[:limit]]


def _vref(surah: int, first: int, last: int) -> str:
    return f"{surah}:{first}" + (f"-{last}" if last != first else "")


def _reference_text(surah: int, ayah: int) -> str:
    """The published translation of a verse, unchanged, with what QuranEnc asks to mention (translator, source, version)."""
    text = neura_quran_fr.translation(surah, ayah)
    if not text:
        return ""
    if len(text) > 420:
        return f" (voir la {neura_quran_fr.attribution()})"
    return f" ; traduction de référence de {surah}:{ayah} : « {text} » ({neura_quran_fr.attribution()})"


def _fr_quotes(text: str) -> List[Tuple[int, int, str, List[str]]]:
    """French quotations (Arabic ones are compared word by word with the Quran elsewhere)."""
    out = []
    for m in _QUOTE_RE.finditer(text):
        quote = next(g for g in m.groups() if g)
        words = _qwords(quote)
        if len(words) >= 3 and len(re.findall(r"[a-zA-ZÀ-ÿ]", quote)) > len(re.findall(r"[؀-ۿ]", quote)):
            out.append((m.start(), m.end(), quote, words))
    return out


_PARAPHRASE_RE = re.compile(r"en substance|autrement dit|le sens (?:general |global )?(?:est|de ce verset)|paraphras|resum|"
                            r"approximativ|librement|ce qui signifie|c'est-a-dire|en d'autres termes|explication du sens")


def _verbatim_translation(surah: int, first: int, last: int) -> Optional[str]:
    """The published translation of the verses cited, unchanged, with its attribution (none if too long to show)."""
    texts = [neura_quran_fr.translation(surah, a) for a in range(first, last + 1)]
    if not all(texts) or sum(len(t) for t in texts) > 600:
        return None
    return f"« {' '.join(texts)} » ({neura_quran_fr.attribution()})"


def _compare_translation(quote: str, words: List[str], ref: "QuranRef", original: str,
                         quote_span: Optional[Tuple[int, int]] = None, context: str = "") -> Finding:
    label = f"Coran {_vref(ref.surah, ref.first, ref.last)} (traduction)"
    span = (ref.start, ref.end)
    if len(re.findall(r"\b(?:al|ad|an|ar|as|at|ash|wa|bi|li|fi|min|alayhi|yawm\w*|rabb\w*|allahu|ar-?rahman\w*)\b|\w-\w{1,3}-\w",
                      fold(quote))) >= 2:
        return Finding("ok", "traduction", f"{label} : « {_short(quote)} » est une translittération, pas une traduction.", span)
    cited = verse_cover(words, ref.surah, ref.first, ref.last)
    exclude = frozenset((ref.surah, a) for a in range(ref.first, ref.last + 1))
    other = (best_verses(words, exclude) or [None])[0]
    shown = f"« {_short(quote)} »"
    if other and other[0] >= 0.6 and other[0] >= cited + 0.3 and (cited < 0.5 or (other[0] >= 0.9 and other[0] >= cited + 0.35)):
        pass  # the words belong to another verse (« aux deux extrémités du jour » is 11:114, not 17:78)
    elif cited >= 0.75 or (cited >= 0.5 and (len(words) > 5 or len(_missing(words, ref.surah, ref.first, ref.last)) <= 1)):
        return Finding("ok", "traduction", f"{label} : {shown} correspond aux traductions de référence "
                       "(Rachid Maach ; Noor International Center — QuranEnc.com).", span)
    if other and other[0] >= 0.6 and other[0] >= cited + 0.3:
        right = _vref(*other[1:])
        return Finding("error", "traduction", f"{label} : {shown} n'est pas la traduction de ce verset ; ce texte correspond à "
                       f"{right} ({surah_label(other[1])}){_reference_text(ref.surah, ref.first)}.", span,
                       fix=f"{right} [référence corrigée]")
    if cited < 0.2 and len(words) >= 5:
        return Finding("error", "traduction", f"{label} : {shown} ne correspond pas à ce verset"
                       f"{_reference_text(ref.surah, ref.first)}.", span, fix=original + " [traduction non conforme à ce verset]")
    missing = _missing(words, ref.surah, ref.first, ref.last)
    if _PARAPHRASE_RE.search(fold(context)):
        return Finding("ok", "traduction", f"{label} : {shown} est présenté comme une explication du sens, pas comme une citation"
                       f"{_reference_text(ref.surah, ref.first)}.", span)
    # words that are in no form in the verse (« deveniez riches » for 2:183): the meaning is changed, not only the wording
    cited_text = _cited_text(ref.surah, ref.first, ref.last)
    absent = [w for w in missing if len(w) >= 4 and f" {w[:4]}" not in cited_text]
    reference = _verbatim_translation(ref.surah, ref.first, ref.last)
    if len(absent) >= 2 and cited < 0.6 and len(words) <= 10:
        return Finding("error", "traduction", f"{label} : {shown} modifie le sens du verset (ces mots n'y figurent sous aucune forme : "
                       f"{', '.join(absent[:6])}){_reference_text(ref.surah, ref.first)}.", quote_span if reference and quote_span else span,
                       fix=(reference + f" ({_vref(ref.surah, ref.first, ref.last)})") if reference and quote_span else
                       original + " [traduction non conforme à ce verset]")
    return Finding("warn", "traduction", f"{label} : {shown} ne correspond pas mot pour mot (autre traduction ou paraphrase ; "
                   f"mots absents des traductions de référence : {', '.join(missing[:6])})"
                   f"{_reference_text(ref.surah, ref.first)}.", span)


def question_quran(question: str) -> List[dict]:
    """French quotations of the Quran in a question, compared with the verse they are said to be (or looked for)."""
    if not question or not neura_quran_fr.available():
        return []
    clean = re.sub(r"[*_`>]", " ", question)
    refs = [r for r in quran_refs(clean) if 1 <= r.surah <= 114 and r.first >= 1 and (verse_count(r.surah) or 0) >= r.last]
    talk = re.search(r"coran|qur|verset|sourate|surah|ayat|allah|سورة|آية", fold(clean))
    out = []
    for start, end, quote, words in _fr_quotes(clean):
        near = sorted((min(abs(r.start - end), abs(start - r.end)), i) for i, r in enumerate(refs))
        ref = refs[near[0][1]] if near and near[0][0] <= 200 else None
        if ref is None and not talk:
            continue
        item = {"quote": quote, "words": words, "ref": ref}
        if ref:
            exclude = frozenset((ref.surah, a) for a in range(ref.first, ref.last + 1))
            cited = verse_cover(words, ref.surah, ref.first, ref.last)
            best = (best_verses(words, exclude) or [None])[0]
            item["cited"] = cited
            if best and best[0] >= 0.6 and best[0] >= cited + 0.3:
                item.update(kind="ailleurs", best=best)
            elif cited >= 0.85:
                item["kind"] = "conforme"
            else:
                item.update(kind="modifiée", missing=_missing(words, ref.surah, ref.first, ref.last))
        else:
            best = (best_verses(words) or [None])[0]
            if best and best[0] >= 0.6:
                item.update(kind="trouvée", best=best)
            else:
                item["kind"] = "introuvable"
        out.append(item)
    return out


def _question_quran_lines(question: str) -> List[str]:
    lines = []
    for item in question_quran(question):
        q = f"« {_short(item['quote'], 160)} »"
        ref = item["ref"]
        if item["kind"] == "ailleurs":
            s, a, b = item["best"][1:]
            lines.append(f"- La phrase citée dans la question {q} N'EST PAS la traduction de {_vref(ref.surah, ref.first, ref.last)} : "
                         f"elle correspond à {_vref(s, a, b)} ({surah_label(s)}). Dis-le clairement"
                         f"{_reference_text(ref.surah, ref.first)}{_reference_text(s, a)}.")
        elif item["kind"] == "conforme":
            lines.append(f"- La phrase citée {q} correspond bien à {_vref(ref.surah, ref.first, ref.last)} (traductions de référence).")
        elif item["kind"] == "modifiée":
            lines.append(f"- La phrase citée {q} ne correspond pas mot pour mot à {_vref(ref.surah, ref.first, ref.last)} : ces mots ne "
                         f"figurent dans aucune des deux traductions de référence : {', '.join(item['missing'][:6]) or '—'}. Ce peut être "
                         "une autre traduction du sens, une paraphrase ou un sens modifié : compare avec la traduction de référence et "
                         f"dis-le avec précision{_reference_text(ref.surah, ref.first)}.")
        elif item["kind"] == "trouvée":
            s, a, b = item["best"][1:]
            lines.append(f"- La phrase citée {q} correspond au Coran {_vref(s, a, b)} ({surah_label(s)}){_reference_text(s, a)}.")
        else:
            lines.append(f"- La phrase citée {q} n'a été retrouvée dans aucun verset des deux traductions françaises de référence : "
                         "ne lui attribue aucun verset sans certitude.")
    return lines


def _translation_findings(answer: str, qrefs: List["QuranRef"], hrefs: List[HadithRef], question: str) -> List[Finding]:
    """A French translation quoted next to a verse reference must be the translation of that verse."""
    if not neura_quran_fr.available():
        return []
    clean = re.sub(r"[*_`>]", " ", answer)
    quotes = _fr_quotes(clean)
    marks = [(r.start, r.end) for r in qrefs] + [(r.start, r.end) for r in hrefs]
    books = [(m.start(), m.end()) for m in _BOOK_RE.finditer(clean)]
    out, used = [], set()
    valid = [r for r in qrefs if 1 <= r.surah <= 114 and r.first >= 1 and (verse_count(r.surah) or 0) >= r.last]
    pairs = {}
    for quote in quotes:
        def free(a: int, b: int, ref) -> bool:
            return not any(a <= s < b for s, _ in marks + books if s != ref.start)
        options = []
        for ref in valid:
            if quote[1] <= ref.start and ref.start - quote[1] <= 250 and free(quote[1], ref.start, ref):
                distance = ref.start - quote[1]
            elif quote[0] >= ref.end and quote[0] - ref.end <= 300 and free(ref.end, quote[0], ref):
                distance = quote[0] - ref.end
            else:
                continue
            options.append((-verse_cover(quote[3], ref.surah, ref.first, ref.last), distance, ref.start, ref))
        if options:
            ref = min(options, key=lambda o: o[:3])[3]
            pairs.setdefault(ref.start, (ref, []))[1].append(quote)
    for ref, paired in pairs.values():
        quote = min(paired, key=lambda q: min(abs(ref.start - q[1]), abs(q[0] - ref.end)))
        used.update(q[0] for q in paired)
        context = fold(clean[max(0, quote[0] - 160): quote[0]] + " " + _sentence(clean, ref.start, ref.end))
        if _QNEG_RE.search(context):
            continue  # quoted to be corrected
        if any(abs(s - quote[0]) < 150 or abs(s - quote[1]) < 150 for s, _ in books):
            continue  # a hadith
        out.append(_compare_translation(quote[2], quote[3], ref, answer[ref.start:ref.end], (quote[0], quote[1]),
                                        clean[max(0, quote[0] - 160): quote[1] + 120]))
    # « Allah dit : « … » » with no reference
    for start, end, quote, words in quotes:
        if start in used or len(words) < 4:
            continue
        intro = fold(clean[max(0, start - 100): start])
        if not _QURAN_INTRO_RE.search(intro) or re.search(r"qudsi|hadith|proph|messager", intro):
            continue
        if any(abs(s - start) < 300 or abs(s - end) < 300 for s, _ in marks + books):
            continue
        best = (best_verses(words) or [None])[0]
        if best and best[0] >= 0.6:
            out.append(Finding("ok", "traduction", f"« {_short(quote)} » : correspond au Coran {_vref(*best[1:])} ({surah_label(best[1])}).",
                               (start, end)))
        elif (not best or best[0] < 0.35) and len(words) >= 5 and not _HEDGE_RE.search(fold(clean[max(0, start - 200): end + 150])):
            out.append(Finding("warn", "traduction", f"« {_short(quote)} » : présenté comme une parole d'Allah, mais non retrouvé dans "
                               "les deux traductions françaises de référence : à vérifier.", (start, end)))
    # what the question quoted
    head = fold(answer[:400])
    said_no = re.search(r"\bnon\b|ne dit pas|n'est pas|pas exact|inexact|ne correspond|ne figure|ne s'agit pas|erreur|errone|confusion", head)
    for item in question_quran(question):
        q = f"« {_short(item['quote'])} »"
        ref = item["ref"]
        if item["kind"] == "ailleurs":
            s, a, b = item["best"][1:]
            if said_no or any(r.surah == s and r.first <= b and r.last >= a for r in qrefs):
                continue
            out.append(Finding("error", "traduction", f"Question {q} : cette phrase est la traduction de {_vref(s, a, b)}, pas de "
                               f"{_vref(ref.surah, ref.first, ref.last)}, et la réponse ne le dit pas{_reference_text(ref.surah, ref.first)}."))
        elif item["kind"] == "modifiée" and item["cited"] < 0.6:
            if not said_no and re.search(r"\boui\b|c'est exact|c'est bien|tout a fait|exactement|correct|en effet", head):
                out.append(Finding("error", "traduction", f"Question {q} : la réponse confirme cette phrase, mais elle ne correspond pas à "
                                   f"{_vref(ref.surah, ref.first, ref.last)} (mots absents des traductions de référence : "
                                   f"{', '.join(item['missing'][:6])}){_reference_text(ref.surah, ref.first)}."))
        elif item["kind"] == "trouvée":
            s, a, b = item["best"][1:]
            for r in qrefs:
                if r.surah == s and r.first <= b and r.last >= a:
                    continue
                sentence = fold(_sentence(clean, r.start, r.end))
                if re.search(r"ce verset (?:est|se trouve)|il s'agit (?:du|de la)|se trouve (?:dans|au|a la)|c'est (?:le|la) (?:verset|sourate)|"
                             r"correspond (?:au|a la)|est le verset|verset est", sentence) and not _QNEG_RE.search(sentence):
                    out.append(Finding("error", "traduction", f"Coran {_vref(r.surah, r.first, r.last)} : la phrase de la question {q} "
                                       f"n'est pas dans ce verset ; elle correspond à {_vref(s, a, b)} ({surah_label(s)}).",
                                       (r.start, r.end), fix=f"{_vref(s, a, b)} [référence corrigée]"))
    return out


# ----------------------------------------------------------------- fiqh: schools, consensus, scholars, fatwas
FIQH = DATA / "religion" / "fiqh.json"


@lru_cache(maxsize=1)
def fiqh() -> dict:
    data = json.loads(FIQH.read_text(encoding="utf-8"))
    for item in data["sujets"]:
        item["_mots"] = [re.compile(r"\b" + re.escape(fold(w)) + (r"\b" if len(fold(w)) <= 3 else "")) for w in item["mots"]]
        item["_contexte"] = [re.compile(r"\b" + re.escape(fold(w))) for w in item["contexte"]]
    return data


def fiqh_topics(text: str, context: str = "") -> List[dict]:
    """The subjects of the fiqh file that a sentence is about (its context words may be in the question)."""
    t = fold(text)
    c = t + " " + fold(context)
    return [item for item in fiqh()["sujets"]
            if any(r.search(t) for r in item["_mots"]) and (not item["_contexte"] or any(r.search(c) for r in item["_contexte"]))]


_CONSENSUS_RE = re.compile(r"consensus|ijma|unanim|tous les savants|tous les oulemas|toutes les ecoles|"
                           r"les quatre ecoles (?:sont|s'accordent|disent|considerent|jugent|admettent|interdisent|permettent|imposent)|"
                           r"(?:aucune|pas de|sans) divergence|s'accordent|font l'unanimite|sont d'accord|d'un commun accord")
_CONSENSUS_NEG_RE = re.compile(r"(?:pas|aucun|aucune|ni|sans|non|absence)\s+(?:de\s+|d'|du\s+)?(?:veritable\s+|reel\s+)?(?:consensus|unanimit|ijma)|"
                               r"ne (?:sont|font|s'accordent) pas|pas (?:tous )?d'accord|n'y a pas (?:de )?(?:consensus|unanimit)|"
                               r"divergen|ne fait pas l'unanimite|ikhtilaf|desaccord")
_UNIVERSAL_RE = re.compile(r"obligatoire pour (?:tous|tout|chaque)|tous les musulmans (?:doivent|sont tenus)|tout musulman doit|"
                           r"chaque musulman doit|est (?:une )?obligation|est obligatoire|sont obligatoires|"
                           r"est (?:strictement |formellement )?interdit|est haram|est illicite|annule (?:les |l'|vos |tes |ses )?ablution|"
                           r"n'annule pas|invalide (?:la priere|le jeune|les ablutions)|il faut absolument|est un peche|doit obligatoirement")
_NOT_OBLIGED_RE = re.compile(r"n'est pas (?:obligatoire|interdit|une obligation|haram)|ne sont pas obligatoires|pas obligatoire|non obligatoire")
_SCHOOL_RE = re.compile(r"selon|d'apres|chez les|pour les|ecole|madhh|malikit|hanafit|chafeit|chafiit|shafi|hanbalit|avis|divergen|"
                        r"certains|d'autres|majorit|minorit|plupart|opinion|consider|estim|savants|jurist|abu hanifa|malik|ahmad")
_PERSONAL_RE = re.compile(r"\b(?:mon|ma|mes|notre|nos)\s+(?:mari|femme|epouse|epoux|enfants?|pere|mere|frere|soeur|cas|situation|famille|"
                          r"heritage|divorce|mariage|fiance|fiancee|dette|credit|patron|employeur)\b|dans mon cas|"
                          r"\bje (?:veux|voudrais|vais) (?:divorcer|me marier|epouser)")
_COMPLEX_RE = re.compile(r"divorc|talaq|repudi|khul|heritage|succession|garde des|pension|mariage|epous|dette|credit|pret|interet|"
                         r"serment|kaffara|apostas|avortement|contracept|conversion|tutelle|wali|\bdot\b|mahr|polygam|iddah?|viduite|charia")


SCHOOLS = {"hanafite": r"hanaf|hanef|ab[ou]+ han[iy]fa", "malikite": r"malikit|maliki\b|malikis|l'imam malik\b",
           "chafeite": r"chaf[eiy]|shaf[iy]", "hanbalite": r"hanbal|l'imam ahmad\b"}


def _school_positions(sentence: str, question: str) -> List[Finding]:
    """« Selon les hanafites, toucher une femme annule les ablutions » : the position given to a school is compared
    with the one written in the fiqh file, for the few yes/no questions where the file states it school by school."""
    out = []
    s = fold(sentence)
    if not any(re.search(p, s) for p in SCHOOLS.values()):
        return out
    for topic in fiqh_topics(sentence, question):
        positions = topic.get("positions")
        if not positions or (positions.get("contexte") and not re.search(positions["contexte"], s + " " + fold(question))):
            continue
        # « les hanafites … ; les chaféites … », « … alors que les malikites … » : each part speaks of its schools
        for part in re.split(r";|\balors que\b|\btandis que\b|, mais\b|\bpar contre\b|\bcontrairement\b|\bà l'inverse\b|\(|\)", s):
            schools = [(name, m) for name, pattern in SCHOOLS.items() for m in re.finditer(pattern, part)]
            # the subject itself must be named in this part (« les saignements (pour les hanafites), la viande de chameau
            # (pour les hanbalites) » : each school goes with its own subject)
            if not schools or not any(r.search(part) for r in topic["_mots"]):
                continue
            # schools listed together (« les écoles malikite, chaféite et hanbalite ») share what follows them, up to
            # the next group (« …, l'école hanafite permet… »)
            schools.sort(key=lambda item: item[1].start())
            groups = []
            for name, m in schools:
                if groups and re.fullmatch(r"[\s,]*(?:et|ou)?[\s]*(?:les |l'|la )?(?:ecoles? )?", part[groups[-1][-1][1].end():m.start()]):
                    groups[-1].append((name, m))
                else:
                    groups.append([(name, m)])
            for index, group in enumerate(groups):
                window = part[(group[0][1].start() if index else 0): (groups[index + 1][0][1].start() if index + 1 < len(groups) else len(part))]
                clause_start = part.rfind(",", 0, group[0][1].start()) + 1
                clause_end = part.find(",", group[-1][1].end())
                clause = part[clause_start: len(part) if clause_end < 0 else clause_end]
                said = None
                for text in (clause, window):
                    if re.search(positions["non"], text):
                        said = "non"
                    elif re.search(positions["oui"], text):
                        said = "oui"
                    if said:
                        break
                if not said:
                    continue
                for school, _ in group:
                    expected = positions["ecoles"].get(school)
                    if expected and expected != said:
                        out.append(Finding("error", "fiqh", f"Position attribuée à l'école {school} sur « {positions['question']} » "
                                           f"contraire à la fiche de l'application ({expected} pour cette école) : {topic['texte']}"))
    return out


def personal_case(question: str) -> bool:
    q = fold(question)
    return bool(_PERSONAL_RE.search(q) and _COMPLEX_RE.search(q))


def _fiqh_findings(answer: str, question: str) -> List[Finding]:
    """A consensus is claimed only where there is one; an opinion of some schools is not a rule for every Muslim."""
    out, seen = [], set()
    clean = re.sub(r"[*_`>#|]", " ", answer)
    asked = fiqh_topics(question)
    previous = ""
    for sentence in (s for s in re.split(r"(?<=[.!?\n])\s+", clean) if s.strip()):
        s = fold(sentence)
        topics = fiqh_topics(sentence, question)
        out += [f for f in _school_positions(sentence, question) if f.message.split(" : ")[0] not in seen]
        seen.update(f.message.split(" : ")[0] for f in out)
        if re.search(r"hadith|chaine|isnad|authenti|faible|sahih|da'?if|narrat|rapporteur", s):
            previous = sentence
            continue  # the grade of a hadith, compared with the base elsewhere
        if _CONSENSUS_RE.search(s) and (re.search(r"(?:aucune|pas de|sans) divergence", s) or not _CONSENSUS_NEG_RE.search(s)):
            subjects = topics or (asked if len(asked) == 1 and len(s.split()) <= 25 else [])
            if not subjects and "consensus?" not in seen:
                seen.add("consensus?")
                out.append(Finding("warn", "fiqh", f"Consensus affirmé (« {_short(sentence, 70)} ») : sujet absent des fiches de "
                                   "l'application, consensus non vérifiable automatiquement (à confirmer)."))
            nuanced = bool(re.search(r"en general|majorit|plupart|minorit|discut|controvers|debat|nuanc|exception|sauf\b|avis different", s))
            agreed = any(t["statut"] == "consensus" for t in subjects)
            for t in subjects:
                if t["id"] in seen:
                    continue
                seen.add(t["id"])
                if t["statut"] != "consensus" and (nuanced or agreed):
                    out.append(Finding("warn", "fiqh", f"Accord affirmé sur un point lié à {t['sujet']} : à vérifier, les écoles "
                                       f"divergent sur ce sujet ({t['texte']})"))
                    continue
                if t["statut"] == "consensus":
                    out.append(Finding("ok", "fiqh", f"Consensus sur {t['sujet']} : confirmé par les fiches ({t['texte']})"))
                elif re.search(r"sunna|recommand|valide|validit|pas obligatoire|non obligatoire|les deux|pilier", s):
                    out.append(Finding("warn", "fiqh", f"Consensus affirmé sur un aspect de {t['sujet']} : à vérifier, les écoles "
                                       f"divergent sur ce sujet ({t['texte']})"))
                else:
                    out.append(Finding("error", "fiqh", f"Consensus inventé sur {t['sujet']} : les écoles divergent — {t['texte']}"))
        elif _UNIVERSAL_RE.search(s) and not _NOT_OBLIGED_RE.search(s):
            divergent = [t for t in topics if t["statut"] == "divergence"]
            if divergent and not _SCHOOL_RE.search(s) and not _SCHOOL_RE.search(fold(previous)) and "u:" + divergent[0]["id"] not in seen:
                t = divergent[0]
                seen.add("u:" + t["id"])
                out.append(Finding("error", "fiqh", f"Règle pour tous (« {_short(sentence, 70)} ») alors que les écoles divergent "
                                   f"sur {t['sujet']} : {t['texte']}"))
        previous = sentence
    return out


# Scholars and bodies whose opinions are often quoted. The application has neither their books nor a base of fatwas.
SCHOLARS = {
    "Ibn Taymiyya": r"ibn\s*-?\s*taym[iy]+(?:y?a|ah)\b", "Ibn al-Qayyim": r"ibn\s*(?:al|el)?\s*-?\s*qa[iy]+i?m\b",
    "Ibn Bâz": r"ibn\s*-?\s*baz\b", "al-Albânî": r"alban[iy]\b", "Ibn ʿUthaymîn": r"\buth?a[iy]m[iy]ne?\b|othaymine?\b",
    "an-Nawawî": r"(?<!hadiths d')(?<!hadiths d'an-)(?<!40 )\bnawaw[iy]\b", "Ibn Hajar": r"ibn\s*-?\s*hajar\b",
    "al-Qaradâwî": r"qaradaw[iy]", "Ibn Kathîr": r"ibn\s*-?\s*kath[iy]r\b", "al-Qurtubî": r"qurt[uo]b[iy]|qortobi",
    "al-Ghazâlî": r"ghazal[iy]\b", "as-Suyûtî": r"suy[ou]+t[iy]\b", "adh-Dhahabî": r"dhahab[iy]\b", "Ibn Hazm": r"ibn\s*-?\s*hazm\b",
    "al-Munajjid": r"munajjid", "Abû Hanîfa": r"ab[ou]+\s*-?\s*han[iy]fa", "ash-Shâfiʿî": r"(?:l'imam|imam)\s+(?:ash-|as-|al-)?\s*shafi'?[iy]\b",
    "Ahmad ibn Hanbal": r"ahmad\s+ibn\s+hanbal|l'imam ahmad\b", "Mâlik": r"l'imam malik\b",
    "Al-Azhar": r"\bal-?\s*azhar\b", "Dar al-Iftâ'": r"dar\s+al-?\s*ifta", "le Comité permanent": r"comite permanent|lajna",
    "IslamWeb": r"islam\s*-?\s*web", "IslamQA": r"islam\s*-?\s*qa\b", "le Conseil européen de la fatwa": r"conseil europeen (?:de la|des) (?:fatwa|recherche)",
    "l'Académie du fiqh": r"academie (?:islamique )?(?:internationale )?du fiqh",
}
_SAY_VERB = (r"(?:a dit|dit|disait|a ecrit|ecrit|affirm|declar|consider|jug|estim|a (?:emis|rendu|publie)|fatwa|avis|position|soutien|"
             r"stipul|precis|explique|interdi|autoris|perme|enseign|tranch|condamn|recommand)")
_FATWA_NUM_RE = re.compile(r"fatw[aā]s?\s*(?:n\s*[°ºo]\.?\s*|num[ée]ro\s*|#\s*)\d{2,7}|(?:islam\s*-?\s*(?:qa|web)|dar al-?ift[aâ]['’]?)"
                           r"[^.\n]{0,40}?(?:n\s*[°ºo]\.?\s*|num[ée]ro\s*|#\s*)\d{2,7}", re.I)
_VERBATIM_RE = re.compile(r"mot pour mot|textuellement|litteralement|texte exact|verbatim|ses propres mots|je cite|voici sa fatwa|voici le texte")
# The scholars whose grades are in the hadith base (« Sahih selon al-Albânî »).
GRADERS = {"al-Albânî": r"alban[iy]", "Zubair ʿAlî Zaï": r"zubair|zubayr|zoubair|ali zai", "Shuʿayb al-Arnaʾût": r"arna'?[uo]+t",
           "Ahmad Shâkir": r"shakir|chakir", "Bashshâr ʿAwwâd": r"bashar|bachar|maarouf", "Abû Ghudda": r"ghuddah?|ghouddah?"}
_GRADE_WORD_RE = re.compile(r"sahih|authentique|hasan|\bbon\b|da'?if|daif|faible|munkar|mawdu|forge|invente|tres faible")


def _grade_kind(text: str) -> Optional[str]:
    t = fold(text)
    if re.search(r"da'?if|daif|faible|munkar|mawdu|forg|fabricat|invent|matruk|batil|shadh", t):
        return "faible"
    if re.search(r"sahih|authentique|hasan|\bbon\b|jayyid|qawi|agreed", t):
        return "authentique"
    return None


def _grader_findings(answer: str, ref: HadithRef, rows: List[dict], label: str) -> List[Finding]:
    """« Sahih selon al-Albânî » next to a numbered hadith: compared with the grades of the base."""
    if not any(row.get("g") for row in rows):
        return []  # al-Bukhârî, Muslim, an-Nawawî: no grades in the base to compare with
    # the sentence of the number and the next line (« Authenticité : Sahih selon al-Albânî »), not the neighbouring ones
    head = max(answer.rfind(". ", 0, ref.start), answer.rfind("\n", 0, ref.start), ref.start - 200, 0)
    line_end = answer.find("\n", ref.end)
    next_end = answer.find("\n", line_end + 1) if line_end >= 0 else -1
    tails = [i for i in (answer.find(". ", ref.end), line_end) if i >= 0]
    tail = min(tails) if tails else len(answer)
    if tail == line_end and next_end >= 0 and not _GRADE_WORD_RE.search(fold(answer[head:line_end])):
        tail = next_end  # the grade written on the next line
    window = fold(answer[head: min(tail, ref.end + 300)])
    out, agreeing, absent = [], [], []
    for name, pattern in GRADERS.items():
        m = re.search(pattern, window)
        if not m:
            continue
        line_start = window.rfind("\n", 0, m.start()) + 1
        line_end = window.find("\n", m.end())
        line_end = len(window) if line_end < 0 else line_end
        previous = [g for g in _GRADE_WORD_RE.finditer(window, line_start, m.start()) if m.start() - g.end() <= 60]
        following = [g for g in _GRADE_WORD_RE.finditer(window, m.end(), line_end) if g.start() - m.end() <= 50]
        if previous and not re.search(r"[.;!?]", window[previous[-1].end():m.start()]):
            claimed = _grade_kind(previous[-1].group(0))  # « Sahih selon al-Albânî », « très faible (al-Albânî) »
        elif following:
            claimed = _grade_kind(following[0].group(0))
        elif previous:
            claimed = _grade_kind(previous[-1].group(0))
        else:
            continue
        base = [g for row in rows for g in row.get("g") or [] if re.search(pattern, fold(g[0]))]
        if not base:
            absent.append(name)
        elif claimed in {_grade_kind(g[1]) for g in base}:
            agreeing.append(f"{name} : {base[0][1]}")
        else:
            out.append(Finding("error", "avis", f"{label}, jugement de {name} : la base indique « {'; '.join(g[1] for g in base[:2])} » "
                               f"selon {name}, pas « {claimed} »."))
    if agreeing:
        out.append(Finding("ok", "avis", f"{label}, jugements cités : conformes à la base ({'; '.join(agreeing)})."))
    if absent:
        out.append(Finding("warn", "avis", f"{label}, jugement attribué à {', '.join(absent)} : absent de la base pour ce numéro (à vérifier)."))
    return out


_PAGE_RE = re.compile(r"\b(?:tome|t\.|vol(?:ume)?\.?|juz['’]?|livre)\s*\d{1,3}\s*[,/]?\s*(?:p(?:age)?\.?|pp\.)\s*\d{1,4}"
                      r"|\b(?:p(?:age)?\.|pp\.)\s*\d{1,4}\b", re.I)
# Well-known works of fiqh, hadith, tafsir and creed: a work cited that is not one of them is « to be checked ».
KNOWN_WORKS = ["majmu", "fatawa", "zad al-ma", "i'lam al-muwaqqi", "madarij", "fath al-bari", "riyad as-salih", "riyadh", "al-majmu",
               "minhaj", "al-mughni", "bidayat al-mujtahid", "al-umm", "muwatta", "risala", "mukhtasar", "al-hidaya", "radd al-muhtar",
               "silsila", "sahih al-jami", "da'if al-jami", "irwa", "sifat salat", "tafsir", "jami' al-bayan", "al-jami' li-ahkam",
               "ihya", "bulugh al-maram", "nayl al-awtar", "subul as-salam", "al-adhkar", "kitab at-tawhid", "al-aqida", "sharh",
               "talkhis", "al-muhalla", "al-istidhkar", "at-tamhid", "kashshaf", "mawsu'a", "fiqh as-sunna", "sahih", "sunan", "musnad",
               "mustadrak", "al-kaba'ir", "madkhal", "al-furu", "al-insaf", "rawdat", "mughni al-muhtaj", "tuhfat", "bada'i",
               "al-mabsut", "fatawa al-lajna", "fatawa nur", "liqa'", "al-sharh al-mumti", "ash-sharh al-mumti"]
_WORK_RE = re.compile(r"(?:dans (?:son (?:livre|ouvrage|recueil|traite|commentaire)|l'ouvrage|le livre|ses|son)|ouvrage|livre)\s+"
                      r"[«\"“]?\s*((?:al-|an-|ar-|as-|at-|ash-|adh-|az-)?[A-Z][^«»\"“”\n,;:()]{2,50})")


def _scholar_findings(answer: str, question: str, documented: str = "") -> List[Finding]:
    """Opinions, quotations and fatwas attributed to scholars: never accepted as verified."""
    out, seen = [], set()
    clean = re.sub(r"[*_`>|]", " ", answer)
    for m in _PAGE_RE.finditer(clean):
        context = fold(clean[max(0, m.start() - 160): m.end() + 80])
        if _HEDGE_RE.search(context) or not re.search(r"|".join(SCHOLARS.values()) + r"|fatwa|ouvrage|livre|tafsir|majmu|tome", context):
            continue
        out.append(Finding("error", "citation", f"Référence « {m.group(0).strip()} » : tome et page non vérifiables (l'application n'a pas "
                           "les ouvrages) ; ils ne doivent pas être présentés comme exacts.", (m.start(), m.end()),
                           fix="[tome et page non vérifiés]"))
    for m in _WORK_RE.finditer(clean):
        title = m.group(1).strip()
        if not any(work in fold(title) for work in KNOWN_WORKS) and re.search(r"|".join(SCHOLARS.values()), fold(clean[max(0, m.start() - 160): m.end()])):
            out.append(Finding("warn", "citation", f"Ouvrage cité « {_short(title, 50)} » : absent de la liste des ouvrages connus de "
                               "l'application, son existence et la citation sont à vérifier."))
    for m in _FATWA_NUM_RE.finditer(clean):
        context = fold(clean[max(0, m.start() - 150): m.end() + 150])
        if _HEDGE_RE.search(context) or re.search(r"n'existe pas|pas trouv|introuvable|invent|ne peux pas|impossible|aucune base", context):
            continue
        out.append(Finding("error", "fatwa", f"Fatwa « {_short(m.group(0), 40)} » : numéro de fatwa non vérifiable (l'application n'a pas "
                           "de base de fatwas) ; il ne doit pas être présenté comme certain.", (m.start(), m.end()),
                           fix="fatwa [numéro non vérifié]"))
    text = fold(clean)
    for name, pattern in SCHOLARS.items():
        for m in re.finditer(pattern, text):
            after = text[m.end(): m.end() + 160]
            before = text[max(0, m.start() - 45): m.start()]
            attributed = re.match(r"[^.\n]{0,60}?" + _SAY_VERB, after) or re.search(
                r"(?:selon|d'apres|pour|l'avis d[e'u]|la fatwa d[e'u]|la position d[e'u]|l'opinion d[e'u])\s*(?:l'imam|le cheikh|cheikh|"
                r"sheikh|shaykh|l')?\s*(?:al-|an-|ibn |as-|ash-|adh-)?\W*$", before)
            if not attributed:
                continue
            sentence = _sentence(text, m.start(), m.end())
            if name in GRADERS and _GRADE_WORD_RE.search(sentence) and re.search(r"hadith|n°|\d", sentence):
                continue  # a grade of a hadith: compared with the base next to its number
            quote = _QUOTE_RE.search(after[:200])
            if quote and not re.search(r"[.!?]", after[:quote.start()]):
                said = _short(next(g for g in quote.groups() if g), 50)
                if _VERBATIM_RE.search(sentence + " " + after) and not _HEDGE_RE.search(sentence + " " + after):
                    key, level = "c:" + name, "error"
                    message = (f"Citation de {name} présentée comme exacte (« {said} ») : aucune "
                               "édition de ses écrits n'est disponible pour la vérifier ; elle doit être présentée comme à confirmer "
                               "dans l'ouvrage original (titre, volume, page).")
                else:
                    key, level = "c:" + name, "warn"
                    message = (f"Citation attribuée à {name} (« {said} ») : non vérifiable "
                               "automatiquement — à confirmer dans l'ouvrage original.")
            else:
                key, level = "a:" + name, "warn"
                message = (f"Avis attribué à {name} : non vérifiable automatiquement (l'application n'a ni base de fatwas ni ses "
                           "ouvrages) — à confirmer dans ses écrits ou auprès de la source officielle.")
            if level == "warn" and re.search(pattern, fold(documented)):
                continue  # this judgment of the scholar is in the checked sources given to the model
            if key not in seen:
                seen.add(key)
                out.append(Finding(level, "citation" if key.startswith("c:") else "avis", message))
    if personal_case(question):
        out.append(Finding("warn", "relecture", "Situation personnelle : cette réponse donne des principes généraux ; une décision pour "
                           "votre cas doit être confirmée par un imam, un mufti ou un savant qualifié (relecture humaine conseillée)."))
    return out


def verify(answer: str, grounding: Optional[Grounding] = None, question: str = "") -> List[Finding]:
    """Every Quran and hadith reference of an answer, checked against the sources. A reference is accepted
    only when the hadith at that number really says what the answer attributes to it — even when the
    number came from the question or from the sources given to the model."""
    answer = answer.split(NOTE_HEAD)[0]  # a note already written is not part of what is checked
    findings: List[Finding] = []
    refs = hadith_refs(answer)
    floors = []
    for index, ref in enumerate(refs):
        previous_end = refs[index - 1].end if index else 0
        if index and len(answer[previous_end:ref.start]) <= 40 and not re.search(r"[.!?;\n]", answer[previous_end:ref.start]):
            previous_end = floors[-1]  # « al-Bukhârî n°1 et Muslim n°1907 » : the same hadith, the same quotation
        floors.append(previous_end)
        rows = hadith(ref.book, ref.number)
        label = f"{BOOKS[ref.book]} n°{ref.number}"
        # the sentence of the reference only (« … at-Tirmidhî (n°1956). Il n'existe pas … chez Bukhârî » is about Bukhârî)
        sentence_start = max(answer.rfind(". ", 0, ref.start), answer.rfind("\n", 0, ref.start), 0)
        ends = [i for i in (answer.find(". ", ref.end), answer.find("\n", ref.end)) if i >= 0]
        around = fold(answer[max(sentence_start, ref.start - 140): min(ends + [len(answer)])])
        if re.search(r"n'existe pas|pas trouve|introuvable|non verifi|pas pu (?:etre )?verifi|aucune source|pas de source|"
                     r"ne figure pas|inexistant|n'a pas ete trouve", around):
            # the answer itself says this number is not confirmed: nothing is attributed to it
            findings.append(Finding("ok", "hadith", f"{label} : {'n’existe pas dans le recueil' if not rows else 'non confirmé'}, "
                                    "et la réponse le dit.", (ref.start, ref.end)))
            continue
        if not rows:
            findings.append(Finding("error", "hadith", f"{label} : ce numéro n'existe pas dans le recueil "
                                    f"({_book(ref.book)['numbering']}).", (ref.start, ref.end)))
            # the text given with it: an authentic hadith under its real reference, or a saying found nowhere
            claims = [c for c in _claims(answer, ref.start, "", previous_end)
                      if any(c == next(g for g in m.groups() if g) for m in _QUOTE_RE.finditer(answer))]
            if claims and len(_latin_words(claims[0])) >= 4 and not _NOT_AUTHENTIC_RE.search(around):
                _wrong_number_text(answer, ref, label, claims[0], [], findings)
            continue
        best, words, best_claim = 0.0, [], ""
        for claim in _claims(answer, ref.start, question, previous_end):
            claim_words = [w for w in content_words(claim) if not re.fullmatch(r"\d+", w)]
            score = max(_coverage(claim_words, row["k"]) for row in rows)
            if not words or score > best:
                best, words, best_claim = score, claim_words, claim
        real = (rows[0].get("fr") or rows[0].get("en") or "")[:220]
        # The words quoted may belong to another hadith of the base: then the reference is wrong.
        quoted = any(best_claim == (next(g for g in m.groups() if g)) for m in _QUOTE_RE.finditer(answer + " " + question))
        elsewhere = ([c for c in search_hadith(best_claim, 3, 0.75) if not (c[1] == ref.book and c[2]["n"] == ref.number)]
                     if quoted and len(words) >= 2 else [])  # only a real quotation can belong to another hadith
        better = elsewhere[0] if elsewhere and elsewhere[0][0] >= best + 0.25 else None
        if grounding and (ref.book, ref.number) in grounding.fiche_refs and best >= 0.25:
            level, note = "ok", "trouvé dans la base (référence des fiches vérifiées), le texte correspond"
        elif better and (best < 0.45 or (len(words) < 4 and best < 0.99)):
            # (the other hadith found is not named: a suggestion could itself be wrong)
            level, note = "error", f"les mots attribués ne sont pas dans ce hadith ; ce numéro dit en réalité : « {real}… »"
        elif best >= 0.45 and (len(words) >= 4 or best >= 0.99):
            level, note = "ok", "trouvé dans la base, le texte correspond"
        elif len(words) >= 2 and best < 0.15:
            # not one word in common (« sourire est une aumône » -> Ibn Mâjah 3673, about the neighbours)
            level, note = "error", f"ne correspond pas à ce qui lui est attribué ; ce numéro dit en réalité : « {real}… »"
        elif best >= 0.3 or len(words) < 3 or not any(row.get("fr") for row in rows):
            level, note = "warn", f"correspondance incertaine (à vérifier) ; ce numéro dit : « {real}… »"
        else:
            level, note = "error", f"ne correspond pas à ce qui lui est attribué ; ce numéro dit en réalité : « {real}… »"
        if level != "error":
            other = _narrator_ok(answer, ref.start, rows)
            if other:
                level, note = "error", f"mauvais rapporteur : la base indique « {other} »"
        graders = _grader_findings(answer, ref, rows, label) if level != "error" else []
        findings += graders
        if level != "error":
            grades = [g[1].lower() for g in rows[0].get("g") or []]
            nearby = fold(answer[ref.start: ref.end + 120] + answer[max(0, ref.start - 120): ref.start])
            if grades and re.search(r"authentique|sahih|sahîh", nearby) and grades and all("da" in g or "fabricat" in g or "mawdu" in g for g in grades):
                level, note = "error", "présenté comme authentique alors que la base le classe faible : " + \
                    "; ".join(f"{g[1]} ({g[0]})" for g in rows[0]["g"])
        findings.append(Finding(level, "hadith", f"{label} : {note}", (ref.start, ref.end)))
        if level != "ok" and quoted and len(words) >= 4 and not _NOT_AUTHENTIC_RE.search(around):
            if better and better[1] == ref.book and better[0] >= 0.9:
                if level == "error":
                    findings[-1].fix = f"n°{better[2]['n']} [numéro corrigé]"  # same collection, the right number
            elif level == "error" or min(max(_weighted(_latin_words(best_claim), row["k"]) for row in rows) / 0.35,
                                         max(_rare_found(_latin_words(best_claim), row["k"]) for row in rows) / 2) < 1:
                _wrong_number_text(answer, ref, label, best_claim, rows, findings)

    findings += _weak_called_authentic(answer, grounding, {(f.message.split(" : ")[0]) for f in findings})
    qrefs = quran_refs(answer)
    for ref in qrefs:
        count = verse_count(ref.surah) if 1 <= ref.surah <= 114 else None
        if count is None:
            findings.append(Finding("error", "coran", f"« {ref.text} » : la sourate {ref.surah} n'existe pas.", (ref.start, ref.end)))
        elif ref.first > count or ref.last > count:
            findings.append(Finding("error", "coran", f"« {ref.text} » : ce verset n'existe pas, la {surah_label(ref.surah)} "
                                    f"compte {count} versets.", (ref.start, ref.end)))
        else:
            findings.append(Finding("ok", "coran", f"Coran {ref.surah}:{ref.first}{'-' + str(ref.last) if ref.last != ref.first else ''} : "
                                    f"le verset existe ({surah_label(ref.surah)}).", (ref.start, ref.end)))
    for surah, claimed, sentence in count_claims(answer):
        real = verse_count(surah)
        if real != claimed:
            findings.append(Finding("error", "versets", f"La {surah_label(surah)} compte {real} versets, pas {claimed}."))
    for run in _ARABIC_RUN_RE.findall(answer):
        result = neura_quran.check(run)
        if result and not result["identical"]:
            diffs = "; ".join(_diff_text(d) for d in result["diffs"])
            context = fold(answer[max(0, answer.find(run) - 200): answer.find(run)])
            cited_as_wrong = re.search(r"pas exact|inexact|modifi|alter|diff[ée]ren|au lieu|ne correspond|faute|erreur", context)
            if not cited_as_wrong:
                findings.append(Finding("error", "texte coranique",
                                        f"Le texte arabe « {run[:60]}… » n'est pas exactement celui du Coran "
                                        f"({surah_label(result['surah'])}) : {diffs}."))
    findings += _unnumbered(answer, refs, qrefs, question)  # « rapporté par Muslim » without a number
    findings += _translation_findings(answer, qrefs, refs, question)  # French translations of the verses
    findings += _fiqh_findings(answer, question) + _scholar_findings(
        answer, question, " ".join(grounding.facts) if grounding else "")  # schools, consensus, scholars, fatwas
    return findings


def _local(words: List[str], haystack: str, span: int = 160) -> bool:
    """The words found are close together (one saying), not scattered over a long text: a passage of the text,
    as long as the quotation allows, holds at least three quarters of them (every occurrence is considered)."""
    occurrences, found_words = [], 0
    for index, word in enumerate(dict.fromkeys(words)):
        stems = [" " + _stem(word)] + [" " + en for en in _FR_EN.get(_stem(word), ())]
        at = sorted({m.start() for s in stems for m in re.finditer(re.escape(s), haystack)})
        if at:
            found_words += 1
            occurrences += [(position, index) for position in at]
    if found_words < 2:
        return False
    occurrences.sort()
    width = max(span, 25 * found_words)
    need = max(2, -(-3 * found_words // 4))
    counts: Dict[int, int] = {}
    left = 0
    for position, index in occurrences:
        counts[index] = counts.get(index, 0) + 1
        while position - occurrences[left][0] > width:
            old = occurrences[left][1]
            counts[old] -= 1
            if not counts[old]:
                del counts[old]
            left += 1
        if len(counts) >= need:
            return True
    return False


def _wrong_number_text(answer: str, ref: HadithRef, label: str, claim: str, rows: List[dict], findings: List[Finding]) -> None:
    """The text given with a wrong number: an authentic hadith found elsewhere (reliably) gets its real reference
    in place of the wrong number; a text found nowhere is an invented saying and is removed."""
    found = _search_cached(claim, 1, 0.5)
    if found and found[0][0] >= 0.85 and (found[0][1], found[0][2]["n"]) != (ref.book, ref.number):
        if findings[-1].level == "error" and findings[-1].span == (ref.start, ref.end):
            findings[-1].fix = f"[numéro faux — ce texte se trouve dans {BOOKS[found[0][1]]} n°{found[0][2]['n']}]"
        return
    if found:
        return  # partly found: flagged, not removed
    if rows and min(max(_weighted(_latin_words(claim), row["k"]) for row in rows) / 0.35,
                    max(_rare_found(_latin_words(claim), row["k"]) for row in rows) / 2) >= 1:
        return  # it is (partly) in the hadith of that number
    quote = next((q for q in _outer_quotes(answer) if claim.strip() and (claim.strip() in q[2] or q[2] in claim)), None)
    if quote:
        findings.append(Finding("error", "invention", f"« {_short(claim, 50)} » (attribué à {label}) : parole introuvable dans les 8 "
                                "recueils de la base ; elle ne doit pas être présentée comme un hadith.",
                                _removal_span(answer, (quote[0], quote[1]), (ref.start, ref.end)), fix=REMOVED_SAYING))


def _has_authentic_version(text: str, at_least: float) -> bool:
    """The same words, matched at least as well, in al-Bukhârî or Muslim or in a version graded sahîh / hasan:
    « la purification est la moitié de la foi » is authentic (Muslim 223) even if Ibn Mâjah 356 has a weak version."""
    for score, book, row in search_hadith(text, 8, max(0.6, at_least - 0.01)):
        if book in ("bukhari", "muslim"):
            return True
        grades = [fold(g[1]) for g in row.get("g") or []]
        if any(re.search(r"sahih|hasan", g) and not re.search(r"da'?if|daif", g) for g in grades):
            return True
    return False


def _weak_called_authentic(answer: str, grounding: Optional[Grounding], already: set) -> List[Finding]:
    """« Ce hadith est authentique » about a text that the base classes weak in every version given to the
    model — even when the answer gives no number."""
    out = []
    if not grounding or not re.search(r"authentique|sahih|sahîh", fold(answer)):
        return out
    for book, number in grounding.allowed:
        rows = hadith(book, number)
        grades = [g for row in rows for g in row.get("g") or []]
        if not grades or not all(re.search(r"da'?if|daif|fabricat|mawdu|munkar", fold(g[1])) for g in grades):
            continue
        label = f"{BOOKS[book]} n°{number}"
        if label in already:
            continue
        quoted = [next(g for g in m.groups() if g) for m in _QUOTE_RE.finditer(answer)] or [answer]
        close = [q for q in quoted if _coverage(content_words(q), rows[0]["k"]) >= 0.6]
        if close and not any(_has_authentic_version(q, _coverage(content_words(q), rows[0]["k"])) for q in close):
            out.append(Finding("error", "hadith", f"Le texte présenté comme authentique correspond à {label}, que la base "
                               "classe faible : " + "; ".join(f"{g[1]} ({g[0]})" for g in grades[:4])
                               + ". D'autres savants ont pu juger autrement une autre version : il faut le dire avec nuance."))
    return out


def problems(findings: List[Finding]) -> List[Finding]:
    return [f for f in findings if f.level == "error"]


def revision_request(question: str, draft: str, findings: List[Finding], grounding: Grounding) -> str:
    """The message that asks the model to correct its own answer, with what the sources really say."""
    issues = "\n".join(f"- {f.message}" for f in problems(findings))
    sources = "\n".join(grounding.facts) or "- (aucune)"
    return (
        "La vérification automatique des sources a trouvé des erreurs dans ta réponse ci-dessous. Réécris ta réponse "
        "COMPLÈTE à la question de l'utilisateur en corrigeant ces erreurs : retire ou corrige chaque référence fausse, "
        "n'ajoute aucune nouvelle référence qui ne figure pas dans les sources vérifiées, et si une information ne peut "
        "pas être vérifiée, dis-le simplement : une parole introuvable dans les recueils ne doit plus être présentée "
        "comme une parole du Prophète ﷺ (retire-la et dis que tu ne disposes pas d'une source suffisante pour confirmer "
        "cette attribution ; ne l'attribue pas à un autre recueil) ; un hadith attribué au mauvais recueil se corrige "
        "avec le recueil indiqué ; un hadith faible se présente comme faible ; une attribution non confirmée (savant, "
        "fatwa, recueil) se présente comme à vérifier ; une traduction de verset se corrige avec la traduction de référence et "
        "le bon verset ; un avis d'école se présente comme tel, avec les autres avis, jamais comme un consensus ni comme "
        "une règle pour tous ; la position d'une école se corrige avec la fiche donnée ; un tome, une page, un numéro de "
        "fatwa ou une citation mot pour mot d'un savant qui ne figurent pas dans les sources vérifiées se retirent. "
        "Ne mentionne pas cette vérification ni cette consigne.\n\n"
        f"QUESTION : {question}\n\nTA RÉPONSE :\n{draft}\n\nERREURS DÉTECTÉES :\n{issues}\n\nSOURCES VÉRIFIÉES :\n{sources}"
    )


def neutralise(answer: str, findings: List[Finding]) -> str:
    """Last resort when an error remains: the wrong reference is removed from the text (or corrected, or marked
    as not confirmed)."""
    wanted = []
    for f in problems(findings):
        if not f.span:
            continue
        if f.fix is not None:
            wanted.append((0 if f.kind == "invention" else 1, f.span, f.fix))
        elif f.kind in ("hadith", "coran"):
            wanted.append((1, f.span, " [référence retirée : non vérifiée]"))
    chosen = []  # an invented saying is removed with its reference; then the other edits that do not overlap
    for _, (start, end), text in sorted(wanted, key=lambda w: (w[0], w[1][0] - w[1][1])):
        if not any(start < e and s < end or (start == end and s <= start <= e) or (s == e and start <= s <= end)
                   for (s, e), _ in chosen):
            chosen.append(((start, end), text))
    for (start, end), text in sorted(chosen, reverse=True):
        answer = answer[:start] + text + answer[end:]
    return answer


def note(findings: List[Finding]) -> str:
    """What the user sees under a religious answer that cites sources."""
    if not findings:
        return ""
    icons = {"ok": "✔", "warn": "⚠", "error": "✘"}
    severity = {"ok": 0, "warn": 1, "error": 2}
    kept: Dict[str, Finding] = {}
    for f in findings:  # one line per reference: the most severe verdict when it is cited several times
        label = f.message.split(" : ")[0]
        if label not in kept or severity[f.level] > severity[kept[label].level]:
            kept[label] = f
    lines = [f"- {icons[f.level]} {f.message}" for f in kept.values()]
    if any(f.kind == "invention" for f in findings):
        lines = ["- ✘ Une parole introuvable dans les recueils vérifiés a été retirée : elle ne doit pas être attribuée au "
                 "Prophète ﷺ sans source suffisante."] + lines
    if any(f.kind in ("fiqh", "avis", "citation", "fatwa", "relecture") for f in findings):
        lines = lines[:12] + ["- ℹ Ce contrôle automatique ne remplace pas l'avis d'un savant qualifié ; pour un cas personnel ou "
                              "complexe, une relecture par un imam ou un mufti est conseillée."]
    return ("\n\n---\n**Vérification automatique des sources** (Coran : texte Tanzil, traductions du sens de Rachid Maach et du "
            "Noor International Center — QuranEnc.com ; hadiths : 8 recueils numérotés ; fiqh : fiches des écoles) :\n"
            + "\n".join(lines[:13]))


def enabled() -> bool:
    return os.environ.get("NEURA_RELIGION_CHECK", "on").strip().lower() != "off"

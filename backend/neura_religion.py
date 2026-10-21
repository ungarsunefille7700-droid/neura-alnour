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
import os
import re
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import neura_quran

DATA = Path(__file__).resolve().parent / "data"

BOOKS = {
    "bukhari": "al-Bukhârî", "muslim": "Muslim", "abudawud": "Abû Dâwûd", "tirmidhi": "at-Tirmidhî",
    "nasai": "an-Nasâ'î", "ibnmajah": "Ibn Mâjah", "malik": "le Muwatta' de Mâlik", "nawawi": "les 40 hadiths d'an-Nawawî",
}
# How the collections are written in answers and questions (French, English, Arabic transliterations).
BOOK_PATTERNS = {
    "bukhari": r"b(?:ou|u|o)kh[aâ]r[iîy]|البخاري",
    "muslim": r"\bm(?:ou|u|o)sl[iî]m\b|مسلم",
    "abudawud": r"ab[uoû]+\s*-?\s*d[aâ]w[uoû]+d|ab[uoû]+\s*-?\s*da[ou]u?d|abou\s*daoud|أبو داود|ابو داود",
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
    r"omra|fiqh|halal|haram|imams?|mosqu[ée]es?|fatwas?|madhhab|[ée]coles? juridiques?|malikites?|hanafites?|"
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
bon bonne celebre fameux fameuse connu connue trois deux quatre exacts exactes precis precise numeros authentiques sahihs""".split())

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
    return {"title": doc["title"], "numbering": doc["numbering"], "by_n": by_n}


def hadith(book: str, number: str) -> List[dict]:
    try:
        return _book(book)["by_n"].get(str(int(number)), [])
    except (OSError, ValueError):
        return []


def search_hadith(query: str, limit: int = 3, minimum: float = 0.6, prefer: Tuple[str, ...] = ()) -> List[Tuple[float, str, dict]]:
    """Hadiths of the base that contain most of the words of a quotation; the most precise first (all the
    words, then the shortest text), the collections named by the user first on equal scores."""
    words = list(dict.fromkeys(content_words(query)))
    if len(words) < 2:
        return []
    found = []
    for book in BOOKS:
        for number, rows in _book(book)["by_n"].items():
            for row in rows:
                hits = sum(1 for w in words if _present(w, row["k"]))
                if hits >= 2 and hits / len(words) >= minimum and _local(words, row["k"]):  # one saying, not a long story
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
            before = [b for b in before if re.fullmatch(r"[\s,:()\-–]*", clean[b[1]:start]) and start - b[1] <= 15]
        free = [b for b in before if b[0] not in used_books]
        book = None
        if free:
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
    quran_talk = re.search(r"coran|qur|sourate|surah|verset|ayat|سورة|آية|القرآن", question, re.I)
    for run in _ARABIC_RUN_RE.findall(question):
        if quran_talk or len(neura_quran.words(run)) >= 4 and neura_quran.check(run):
            lines.append(_arabic_line(run))  # an Arabic text of the Quran, or said to be one

    lines = list(dict.fromkeys(lines))
    g.facts = lines
    g.context = (
        "\n\nSOURCES VÉRIFIÉES PAR L'APPLICATION (Coran : texte de référence Tanzil ; hadiths : 8 recueils numérotés, "
        "Muslim selon la numérotation de Fu'âd ʿAbd al-Bâqî ; fiches relues) :\n"
        + ("\n".join(lines) if lines else "- (aucune source précise trouvée pour cette question)")
        + "\n\nRÈGLES DE FIABILITÉ RELIGIEUSE (une vérification automatique contrôle ta réponse) :\n"
        "1. N'écris un numéro de hadith que s'il figure ci-dessus ou si tu en es certain : chaque numéro est contrôlé "
        "dans la base après ta réponse, et un numéro faux est signalé et retiré. Dans le doute, cite le hadith sans "
        "numéro et dis que la référence exacte reste à vérifier ; ne devine jamais un recueil ni un rapporteur.\n"
        "2. N'attribue jamais à un numéro ou à un recueil un texte différent de celui donné ci-dessus ; donne le degré "
        "d'authenticité tel qu'il est indiqué (avec le nom du savant), sans l'arranger.\n"
        "3. Coran : n'écris un numéro de verset, un nombre de versets ou un texte arabe que s'il est donné ci-dessus ou "
        "si tu en es absolument certain ; une traduction doit être présentée comme une traduction du sens, pas comme "
        "le texte du Coran.\n"
        "4. Quand les écoles juridiques divergent, présente les avis ; n'invente jamais un consensus ni une fatwa.\n"
        "5. Si les sources ne permettent pas de répondre, dis-le clairement et indique comment vérifier.\n"
        "6. Réponds naturellement : ne parle pas de cette liste, de « données de référence », de « base de données » "
        "ni de « protocoles » ; cite simplement les sources (recueil, numéro, sourate:verset).\n"
    )
    return g


def _quran_ref_line(ref: QuranRef) -> str:
    count = verse_count(ref.surah) if 1 <= ref.surah <= 114 else None
    if count is None:
        return f"- « {ref.text} » : la sourate {ref.surah} N'EXISTE PAS (le Coran compte 114 sourates)."
    if ref.first > count or ref.last > count:
        return (f"- « {ref.text} » : ce verset N'EXISTE PAS : la {surah_label(ref.surah)} compte {count} versets.")
    verses = [verse_text(ref.surah, a) for a in range(ref.first, min(ref.last, ref.first + 4) + 1)]
    return (f"- Coran {ref.surah}:{ref.first}{'-' + str(ref.last) if ref.last != ref.first else ''} ({surah_label(ref.surah)}, "
            f"{count} versets) — texte arabe exact (Tanzil, sans voyelles) : « {' '.join(verses)} »")


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
    claims = _NARRATOR_RE.findall(near)
    if not claims:
        return None
    claim = claims[-1]
    if re.search(r"bukh|boukh|muslim|tirmidh|nasa|dawud|daoud|majah|malik|ahmad|bayhaq|hakim|tabaran", fold(claim)):
        return None  # "rapporté par al-Bukhârî": a collection, not a narrator
    names = []
    for version in rows:
        names += re.findall(r"[A-ZʿʾÀ-Ý`'’][\w`'’ʿʾ-]{2,}", (version.get("fr") or "")[:700] + " " + (version.get("en") or "")[:700])
    tokens = [_skeleton(t) for t in re.findall(r"[a-z]{3,}", fold(claim)) if t not in ("ibn", "bin", "abu", "abou", "umm", "oum")]
    tokens = [t for t in tokens if len(t) >= 2]
    head_skeletons = {_skeleton(t) for name in names for t in re.findall(r"[a-z]{3,}", fold(name))}
    if not tokens or any(t in head_skeletons for t in tokens):
        return None
    m = re.match(r"\s*(?:rapport[ée] par|narrated|it was narrated (?:from|that)|it is narrated on the authority of)?\s*([^:]{3,80})", row.get("fr") or row.get("en") or "", re.I)
    return (m.group(1).strip() if m else "un autre compagnon")


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
        if level != "error":
            grades = [g[1].lower() for g in rows[0].get("g") or []]
            nearby = fold(answer[ref.start: ref.end + 120] + answer[max(0, ref.start - 120): ref.start])
            if grades and re.search(r"authentique|sahih|sahîh", nearby) and grades and all("da" in g or "fabricat" in g or "mawdu" in g for g in grades):
                level, note = "error", "présenté comme authentique alors que la base le classe faible : " + \
                    "; ".join(f"{g[1]} ({g[0]})" for g in rows[0]["g"])
        findings.append(Finding(level, "hadith", f"{label} : {note}", (ref.start, ref.end)))

    findings += _weak_called_authentic(answer, grounding, {(f.message.split(" : ")[0]) for f in findings})
    for ref in quran_refs(answer):
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
    return findings


def _local(words: List[str], haystack: str, span: int = 160) -> bool:
    """The words found are close together (one saying), not scattered over a long text."""
    positions = []
    for word in words:
        stems = [" " + _stem(word)] + [" " + en for en in _FR_EN.get(_stem(word), ())]
        found = [haystack.find(s) for s in stems if s in haystack]
        if found:
            positions.append(min(found))
    return len(positions) >= 2 and max(positions) - min(positions) <= max(span, 25 * len(positions))


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
        "pas être vérifiée, dis-le simplement. Ne mentionne pas cette vérification ni cette consigne.\n\n"
        f"QUESTION : {question}\n\nTA RÉPONSE :\n{draft}\n\nERREURS DÉTECTÉES :\n{issues}\n\nSOURCES VÉRIFIÉES :\n{sources}"
    )


def neutralise(answer: str, findings: List[Finding]) -> str:
    """Last resort when an error remains: the wrong reference is removed from the text."""
    spans = sorted((f.span for f in problems(findings) if f.span and f.kind in ("hadith", "coran")), reverse=True)
    for start, end in spans:
        answer = answer[:start] + " [référence retirée : non vérifiée]" + answer[end:]
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
    return ("\n\n---\n**Vérification automatique des sources** (Coran : texte Tanzil ; hadiths : 8 recueils numérotés) :\n"
            + "\n".join(lines[:12]))


def enabled() -> bool:
    return os.environ.get("NEURA_RELIGION_CHECK", "on").strip().lower() != "off"

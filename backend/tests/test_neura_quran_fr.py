"""French translations of the meanings of the Quran (QuranEnc): the files are intact and read-only, a translation
quoted next to a verse is compared with that verse. Run again after each update of the translations."""
import hashlib
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import neura_quran_fr as fr  # noqa: E402
import neura_religion as r  # noqa: E402


def errors(answer, question=""):
    return [f for f in r.verify(answer, r.prepare(question or answer, force=True), question) if f.level == "error"]


def kinds(answer, question="", kind="traduction"):
    return [f for f in r.verify(answer, r.prepare(question or answer, force=True), question) if f.kind == kind]


def test_the_files_are_the_published_ones_unchanged():
    source = (fr.DATA / "SOURCE.md").read_text(encoding="utf-8")
    for key, info in fr.TRANSLATIONS.items():
        digest = hashlib.sha256((fr.DATA / info["file"]).read_bytes()).hexdigest()
        assert digest in source, key  # the SHA-256 written when they were copied from QuranEnc.com
        assert info["version"] in source
        assert len(fr.verses(key)) == 6236


def test_the_text_shown_is_the_published_text_with_translator_source_and_version():
    shown = r._reference_text(2, 183)
    assert fr.translation(2, 183) in shown
    assert "Rachid Maach" in shown and "QuranEnc.com" in shown and "1.0.3" in shown
    assert "Rachid Maach, QuranEnc.com, version 1.0.3" in r._quran_ref_line(r.quran_refs("Coran 2:183")[0])


def test_correct_translations_are_kept_even_when_worded_differently():
    for answer in [
        "« Accomplis la prière aux deux extrémités du jour et à certaines heures de la nuit » (Coran 11:114).",
        "« Nulle contrainte en religion ! Car le bon chemin s'est distingué de l'égarement » (Coran 2:256).",  # Hamidullah
        "« Ô vous qui croyez ! Le jeûne vous a été prescrit comme il a été prescrit à ceux d'avant vous, ainsi atteindrez-vous la piété » (2:183).",
        "« Allah ! Point de divinité à part Lui, le Vivant, Celui qui subsiste par lui-même » (Coran 2:255).",
    ]:
        found = kinds(answer)
        assert found and all(f.level == "ok" for f in found), [f.message for f in found]


def test_the_meaning_of_11_114_given_for_17_78_is_caught_and_corrected():
    answer = "Le verset 17:78 dit : « Accomplis la prière aux deux extrémités du jour et à certaines heures de la nuit »."
    found = [f for f in errors(answer) if f.kind == "traduction"]
    assert found and "11:114" in found[0].message
    assert "11:114" in r.neutralise(answer, found)


def test_wrong_surah_and_nonexistent_verse_are_caught():
    wrong_surah = "« Accomplis la prière aux deux extrémités du jour et à certaines heures de la nuit » (sourate Al Imran, verset 114)."
    assert any(f.kind == "traduction" and "11:114" in f.message for f in errors(wrong_surah))
    assert any(f.kind == "coran" for f in errors("« Nulle contrainte en religion » (Coran 3:256)."))


def test_altered_translation_is_flagged_with_the_words_that_are_not_in_the_verse():
    found = kinds("Le verset dit : « Le jeûne vous est prescrit afin que vous deveniez riches » (2:183).")
    assert found and found[0].level != "ok" and "riches" in found[0].message


def test_a_paraphrase_presented_as_a_quotation_is_not_accepted_as_the_verse():
    found = kinds("Allah dit : « Allah aime ceux qui font le bien et déteste les paresseux » (Coran 2:195).")
    assert found and found[0].level != "ok"


def test_an_invented_translation_is_caught():
    found = kinds("Le verset 2:183 dit : « Travaillez dur chaque matin pour devenir riches et puissants sur terre ».")
    assert found and found[0].level == "error"


def test_quoted_to_be_corrected_is_not_an_error():
    answer = ("Non : la phrase « Accomplis la prière aux deux extrémités du jour » n'est pas la traduction de 17:78, "
              "c'est le verset 11:114.")
    assert not [f for f in errors(answer, "Le verset 17:78 dit-il « Accomplis la prière aux deux extrémités du jour » ?")
                if f.kind == "traduction"]


def test_the_question_quote_is_checked_before_and_after():
    question = "Le verset 17:78 dit-il « Accomplis la prière aux deux extrémités du jour » ? Explique."
    context = r.prepare(question).context
    assert "N'EST PAS la traduction de 17:78" in context and "11:114" in context
    wrong = "Oui, c'est bien le sens du verset 17:78 : il ordonne les prières du jour."
    assert any(f.kind == "traduction" for f in errors(wrong, question))
    right = "Non. Cette phrase est celle du verset 11:114 ; le verset 17:78 parle du déclin du soleil."
    assert not [f for f in errors(right, question) if f.kind == "traduction"]


def test_altered_quote_in_the_question_confirmed_by_the_answer_is_caught():
    question = "Le verset 2:183 dit : « Le jeûne vous est prescrit afin que vous deveniez riches. » C'est exact ?"
    assert "riches" in r.prepare(question).context
    assert any(f.kind == "traduction" for f in errors("Oui, c'est exact : le verset 2:183 parle de richesse.", question))
    assert not [f for f in errors("Non, ce n'est pas exact : le verset 2:183 dit « afin de vous préserver du péché ».", question)
                if f.kind == "traduction"]


def test_which_verse_question_with_a_wrong_answer_reference():
    question = "Quel verset dit « Accomplis la prière aux deux extrémités du jour et à certaines heures de la nuit » ?"
    answer = "Ce verset est le verset 78 de la sourate Al-Isra."
    found = [f for f in errors(answer, question) if f.kind == "traduction"]
    assert found and "11:114" in found[0].message
    assert not [f for f in errors("Il s'agit du verset 11:114 (sourate Hud).", question) if f.kind == "traduction"]


def test_transliteration_is_not_a_translation():
    assert not [f for f in kinds("« Maliki yawmi ad-din » (1:4)") if f.level != "ok"]


def test_the_database_is_opened_read_only():
    import sqlite3
    path = fr.DATA / fr.TRANSLATIONS["rashid"]["file"]
    con = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)
    try:
        try:
            con.execute("update translations set translation = translation where id = 1")
            raised = False
        except sqlite3.OperationalError:
            raised = True
        assert raised
    finally:
        con.close()
    assert not re.search(r"\bconnect\([^)]*mode=rw", (fr.DATA.parent.parent / "neura_quran_fr.py").read_text(encoding="utf-8"))

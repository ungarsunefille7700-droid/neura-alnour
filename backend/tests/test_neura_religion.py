"""Religious reliability (neura_religion): verified sources before the answer, every reference checked after.
The wrong answers below are the real errors of Neura v1 / v2 (evaluation of 2026-10-20) and of the current
engine (measure of 2026-10-21): they must be caught; the right references must be accepted."""
import asyncio
import json
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import neura_religion as r  # noqa: E402


def errors(text, question=""):
    return [f for f in r.verify(text, r.prepare(question), question) if f.level == "error"]


# ----------------------------------------------------------------- the hadith base and its numbering
@pytest.mark.parametrize("book,number,words", [
    ("bukhari", "1", "intentions"), ("bukhari", "8", "cinq"), ("bukhari", "6114", "fort"), ("bukhari", "6116", "colère"),
    ("bukhari", "1933", "oubli"), ("muslim", "1907", "intention"), ("muslim", "2609", "fort"), ("muslim", "223", "moitié"),
    ("muslim", "16", "cinq"), ("nasai", "3104", "mère"), ("tirmidhi", "1956", "smiling"),
])
def test_numbers_checked_on_sunnah_com_hold_the_right_text(book, number, words):
    rows = r.hadith(book, number)
    assert rows, (book, number)
    assert any(words.lower() in (row.get("fr", "") + row.get("en", "")).lower() for row in rows)


def test_muslim_is_numbered_like_abdul_baqi_not_like_the_edition_sequence():
    # sunnah.com « Muslim 2609 » = the strong man who controls himself (sequence 2609 of the edition is about fasting)
    assert "fort" in r.hadith("muslim", "2609")[0]["fr"].lower()
    assert r.hadith("muslim", "4521") == []  # does not exist in Abdul-Baqi numbering (the v2 / current engine invention)


def test_grades_keep_the_name_of_the_scholar():
    grades = r.hadith("ibnmajah", "224")[0]["g"]
    assert ["Al-Albani", "Very Daif"] in grades


# ----------------------------------------------------------------- every reference of the fiches is real
def test_every_reference_of_the_fiches_exists_and_matches():
    data = r.fiches()
    for fiche in data["fiches"] + data["non_authentiques"]:
        found = r.verify(fiche["texte"])
        assert not [f for f in found if f.level == "error"], (fiche.get("id"), [f.message for f in found])
        for ref in r.quran_refs(fiche["texte"]):
            assert 1 <= ref.surah <= 114 and ref.last <= r.verse_count(ref.surah), ref


# ----------------------------------------------------------------- finding references in a text
@pytest.mark.parametrize("text,expected", [
    ("al-Bukhârî (n°1) et Muslim (n°1907)", [("bukhari", "1"), ("muslim", "1907")]),
    ("**Sahih al-Bukhari** : Hadith n° **2799** (dans le Livre)", [("bukhari", "2799")]),
    ("Le hadith n°777 du recueil de l'Imam Al-Bukhari traite", [("bukhari", "777")]),
    ("Le hadith n°4521 dans la classification de Sahih Muslim", [("muslim", "4521")]),
    ("**Source :** **Sahih Muslim, Hadith n°2999.**\n\n### 2. La patience", [("muslim", "2999")]),
    ("il s'agit du hadith **n°6116**. **Note :** Ce hadith est également rapporté par l'Imam Muslim", []),
    ("Sunan at-Tirmidhi, Hadith n°1956.", [("tirmidhi", "1956")]),
    ("al-Bukhârî, mort en 870, a compilé", []),
])
def test_references_are_read_like_a_person_would(text, expected):
    assert [(h.book, h.number) for h in r.hadith_refs(text)] == expected


# ----------------------------------------------------------------- hadith errors caught (v2 and current engine)
@pytest.mark.parametrize("answer", [
    # Neura v2 (2026-10-20)
    "Il s'agit de « La propreté fait partie de la foi. » - **Rapporté par :** ʿUmar ibn al-Khattâb. - **Source :** al-Bukhârî (n°6205) et Muslim (n°43).",
    "Il s'agit de « Sourire est une aumône. » - **Rapporté par :** ʿAbdullâh ibn ʿUmar. - **Source :** al-Bukhârî (n°6573).",
    "Il s'agit de « Le paradis est sous les pieds des mères. » - **Rapporté par :** ʿAisha bint Abî Bakr. - **Source :** al-Bukhârî (n°541) et Muslim (n°1577).",
    "Il s'agit de « Le fort n'est pas celui qui terrasse les autres. » - **Rapporté par :** ʿUmar ibn al-Khattâb. - **Source :** al-Bukhârî (n°6013) et Muslim (n°2563).",
    # current engine (2026-10-21)
    "**Sahih al-Bukhari** : Hadith n° **2799**.\n\n> « L'homme fort n'est pas celui qui terrasse les autres dans la lutte, mais celui qui se maîtrise lors d'une colère. »",
    "Le hadith n°4521 dans la classification de Sahih Muslim traite de la pudeur : « La pudeur n'apporte que le bien. »",
    "Le hadith n°777 du recueil de l'Imam Al-Bukhari : « Certes, la foi possède soixante et quelques branches, et la pudeur est une branche de la foi. »",
    "Le Prophète ﷺ a dit : « Accroche-toi à elle, car le Paradis est à ses pieds. » Référence : Rapporté par **Ibn Majah** (n°2739).",
])
def test_invented_hadith_references_are_caught(answer):
    assert errors(answer), answer


@pytest.mark.parametrize("answer", [
    "« Les actions ne valent que par les intentions, et chacun n'aura que ce qu'il a eu l'intention de faire. » Rapporté par ʿUmar ibn al-Khattâb, al-Bukhârî (n°1) et Muslim (n°1907).",
    "« Le fort n'est pas celui qui terrasse les autres, le fort est celui qui se maîtrise quand il est en colère. » Rapporté par Abû Hurayra : al-Bukhârî (n°6114) et Muslim (n°2609).",
    "« Ton sourire face à ton frère est une aumône. » Sunan at-Tirmidhi, Hadith n°1956.",
    "« L'affaire du croyant est étonnante ! Tout ce qui lui arrive est un bien pour lui » **Source :** **Sahih Muslim, Hadith n°2999.**",
    "Celui qui mange ou boit par oubli continue son jeûne (al-Bukhârî n°1933 et Muslim n°1155).",
])
def test_right_hadith_references_are_accepted(answer):
    assert not errors(answer), [f.message for f in r.verify(answer)]


def test_right_numbers_with_the_wrong_narrator_are_caught():
    answer = "« Le fort n'est pas celui qui terrasse les autres, mais celui qui se maîtrise dans la colère. » Rapporté par ʿUmar ibn al-Khattâb, al-Bukhârî (n°6114)."
    assert any("rapporteur" in f.message for f in errors(answer))


def test_a_weak_hadith_presented_as_authentic_is_caught():
    answer = "« La recherche de la science est une obligation pour tout musulman » (Ibn Mâjah n°224), hadith authentique."
    assert any("faible" in f.message for f in errors(answer))


# ----------------------------------------------------------------- Quran errors caught
def test_wrong_number_of_verses_is_caught():
    assert errors("La sourate **An-Nâs** (« Les Hommes ») compte **114 versets**.")
    assert not errors("La sourate **An-Nâs** compte **6 versets**.")
    assert errors("La sourate Al-Ikhlas compte 11 versets.")


def test_verses_that_do_not_exist_are_caught():
    assert errors("Comme le dit le Coran (2:300), la patience est une lumière.")
    assert errors("Il s'agit du verset 92 de la sourate Al-Kahf.") == []  # 18:92 exists (110 verses)
    assert errors("Il s'agit du verset 120 de la sourate Al-Kahf.")


def test_altered_quran_text_is_caught_unless_the_answer_says_it_is_altered():
    altered = "قل هو الله أحد الله الواحد لم يلد ولم يولد ولم يكن له كفوا أحد"
    assert errors(f"Voici le texte de la sourate Al-Ikhlas : {altered}")
    assert not errors(f"Ce texte n'est pas exact : « {altered} » a remplacé « الله الصمد ».")
    assert not errors("Ayat al-Kursi : " + r.verse_text(2, 255))


# ----------------------------------------------------------------- before the answer
def test_non_religious_requests_are_not_touched():
    for question in ["Écris une fonction Python qui trie une liste", "On se voit vendredi ?", "Quelle est la capitale de l'Australie ?",
                     "Le paradis fiscal au Luxembourg", "ما هي عاصمة فرنسا؟"]:
        assert not r.prepare(question).active, question


def test_code_request_with_a_religious_word_is_left_to_the_code_rules():
    assert not r.prepare("Écris un script FiveM pour une mosquée", code_request=True).active
    assert r.prepare("Écris une fonction Python qui renvoie la sourate et le verset de 2:255", code_request=True).active


def test_sources_given_before_the_answer():
    g = r.prepare("Quels sont les cinq piliers de l'islam ?")
    assert g.active and "al-Bukhârî n°8 et Muslim n°16" in g.context
    g = r.prepare("Quel est le texte exact du hadith n°4521 de Muslim ?")
    assert "N'EXISTE PAS" in g.context
    g = r.prepare("Le hadith « le fort n'est pas celui qui terrasse les autres » est dans quel recueil ?")
    assert ("bukhari", "6114") in g.allowed or ("muslim", "2609") in g.allowed
    g = r.prepare("Ce texte du Coran est-il exact ? « قل هو الله أحد الله الواحد لم يلد ولم يولد ولم يكن له كفوا أحد »")
    assert "NON EXACT" in g.context and "الصمد" in g.context
    g = r.prepare("Combien de versets compte la sourate An-Nâs ?")
    assert "6 versets" in g.context
    g = r.prepare("Je n'ai pas d'eau pour mes ablutions, comment prier ?")
    assert "tayammum" in g.context.lower() and "4:43" in g.context


def test_a_hadith_that_is_not_in_the_base_is_announced_as_not_found():
    g = r.prepare("« Le téléphone portable du croyant est une lumière » : est-ce un hadith ?")
    assert "AUCUN hadith correspondant" in g.context
    # a theme alone (no precise text) proves nothing: no « not found » message for it
    assert "AUCUN hadith correspondant" not in r.prepare("Quel hadith de Bukhârî parle des téléphones portables ?").context


# ----------------------------------------------------------------- after the answer
def test_wrong_reference_is_removed_and_the_note_explains_why():
    answer = "Il s'agit de « Sourire est une aumône. » Source : al-Bukhârî (n°6573)."
    findings = r.verify(answer)
    cleaned = r.neutralise(answer, findings)
    assert "6573" not in cleaned and "référence retirée" in cleaned
    assert "✘" in r.note(findings)


def test_server_review_asks_the_model_once_then_removes_what_is_still_wrong(monkeypatch):
    import neura_engine
    import server

    calls = []

    class FakeChat:
        def __init__(self, **kwargs):
            pass

        def with_model(self, *args):
            return self

        def with_params(self, **kwargs):
            return self

        async def send_message(self, message):
            calls.append(message.text)
            return "« Ton sourire face à ton frère est une aumône. » Rapporté par at-Tirmidhî (n°1956)."

    monkeypatch.setattr(neura_engine, "LlmChat", FakeChat)
    question = "Donne-moi le numéro du hadith de Bukhârî qui dit que sourire est une aumône."
    grounding = r.prepare(question)
    draft = "Il s'agit de « Sourire est une aumône. » Source : al-Bukhârî (n°6573)."
    profile = {"provider": "gemini", "model_id": "x", "params": {}}
    answer, summary, extra = asyncio.run(server._religion_review(draft, grounding, question, "système", profile))
    assert len(calls) == 1 and "6573" in calls[0] and "ERREURS DÉTECTÉES" in calls[0]
    assert "1956" in answer and "6573" not in answer.split("---")[0]
    assert summary["error"] == 0 and extra


def test_server_review_never_breaks_an_answer(monkeypatch):
    import server

    monkeypatch.setattr(r, "verify", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    answer, summary, _ = asyncio.run(server._religion_review("Réponse", r.Grounding(active=True), "q", "s", {"model_id": "x", "params": {}}))
    assert answer == "Réponse" and summary is None


# ----------------------------------------------------------------- second series (2026-10-21): other wordings
def test_number_written_after_a_colon_is_read():
    text = "*   **Recueil :** Sahih Muslim\n*   **Numéro :** 2626"
    assert [(h.book, h.number) for h in r.hadith_refs(text)] == [("muslim", "2626")]


def test_words_are_matched_at_the_start_of_words_only():
    assert r._present("fort", r._words_text("le fort est celui")) and not r._present("fort", r._words_text("un grand effort"))


@pytest.mark.parametrize("question,expected", [
    ("C'est quel numéro chez Muslim, le hadith du fort qui se maîtrise quand il est en colère ?", ("muslim", "2609")),
    ("Qui rapporte le conseil « ne te mets pas en colère » ?", ("bukhari", "6116")),
    ("« La recherche de la science est une obligation pour tout musulman » : authentique ? Quel numéro ?", ("ibnmajah", "224")),
])
def test_the_hadith_of_the_question_is_found_in_the_base(question, expected):
    assert expected in r.prepare(question).allowed


def test_weak_hadith_called_authentic_without_a_number_is_caught():
    question = "« La recherche de la science est une obligation pour tout musulman » : authentique ? Quel numéro ?"
    answer = "Ce hadith est considéré comme **authentique** (*Sahih*). « La recherche de la science est une obligation pour tout musulman »."
    assert any("faible" in f.message for f in errors(answer, question))


def test_a_note_already_written_is_not_checked_again():
    answer = "Hadith de Jibril, rapporté par Muslim (n°8)." + r.NOTE_HEAD + " :\n- ⚠ Muslim n°8 : correspondance incertaine"
    assert len([f for f in r.verify(answer) if f.kind == "hadith"]) == 1


def test_number_said_to_be_unverified_by_the_answer_is_not_removed():
    answer = "Je n'ai pas trouvé de source vérifiée pour le hadith portant le numéro 4521 dans le recueil de Muslim."
    assert not errors(answer)


def test_second_reference_of_a_pair_with_nothing_in_common_is_caught():
    # current engine, 2026-10-21: Tirmidhî 1956 is right, « Ibn Mâjah n°3673 » is about the neighbours
    answer = ("Le hadith selon lequel le sourire est une aumône est authentique. Il est rapporté par **at-Tirmidhî** (n°1956) "
              "et **Ibn Mâjah** (n°3673).")
    found = {f.message.split(" : ")[0]: f.level for f in r.verify(answer)}
    assert found["Ibn Mâjah n°3673"] == "error" and found["at-Tirmidhî n°1956"] != "error"


def test_source_line_after_the_text_is_compared_with_what_was_said_before():
    answer = ("Selon le hadith de Jibril rapporté par ʿUmar, croire en l'îmân consiste à croire en Allah, en Ses anges, en Ses "
              "livres, en Ses messagers, au Jour dernier et au destin.\n\n*Source : Hadith rapporté par Muslim (n°8).*")
    assert [f.level for f in r.verify(answer) if f.kind == "hadith"] == ["ok"]

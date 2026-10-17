"""The word-by-word check of a Quran passage against the authentic text (Tanzil), without AI."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import neura_quran  # noqa: E402


def test_the_reference_text_is_complete():
    flat, where, _original, names, _shingles = neura_quran._index()
    assert len(names) == 114 and len({w for w in where}) == 6236


def test_altered_word_found_with_its_verse():
    r = neura_quran.check("قل هو الله أحد ۝ الله الواحد ۝ لم يلد ولم يولد ۝ ولم يكن له كفوا أحد")
    assert (r["surah"], r["ayah_start"], r["ayah_end"], r["identical"]) == (112, 1, 4, False)
    assert r["diffs"] == [{"kind": "remplacé", "ayah": 2, "image": "الواحد", "quran": "الصمد"}]


def test_vowels_and_spelling_variants_do_not_count_as_errors():
    r = neura_quran.check("قُلْ هُوَ اللَّهُ أَحَدٌ ۝ اللَّهُ الصَّمَدُ ۝ لَمْ يَلِدْ وَلَمْ يُولَدْ ۝ وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ")
    assert r["identical"] and r["surah"] == 112


def test_fatiha_with_its_basmala_is_verses_1_to_7():
    text = ("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ (١) الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ (٢) الرَّحْمَٰنِ الرَّحِيمِ (٣) "
            "مَالِكِ يَوْمِ الدِّينِ (٤) إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ (٥) اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ (٦) "
            "صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ (٧)")
    r = neura_quran.check(text)
    assert (r["surah"], r["ayah_start"], r["ayah_end"], r["identical"]) == (1, 1, 7, True)


def test_missing_and_added_words():
    missing = neura_quran.check("الله لا إله إلا هو الحي القيوم لا تأخذه نوم")
    assert missing["surah"] == 2 and missing["ayah_start"] == 255
    assert missing["diffs"] == [{"kind": "manquant", "ayah": 255, "image": "", "quran": "سنة ولا"}]
    added = neura_quran.check("قل هو الله أحد الله الصمد العظيم لم يلد ولم يولد ولم يكن له كفوا أحد")
    assert [d["kind"] for d in added["diffs"]] == ["ajouté"] and added["diffs"][0]["image"] == "العظيم"


def test_not_the_quran():
    assert neura_quran.check("إنما الأعمال بالنيات وإنما لكل امرئ ما نوى") is None
    assert neura_quran.check("Bonjour tout le monde") is None
    assert neura_quran.check("الله") is None


def test_the_note_given_to_the_ai():
    note = neura_quran.verification_note(neura_quran.check("قل هو الله أحد الله الواحد لم يلد ولم يولد ولم يكن له كفوا أحد"))
    assert "N'EST PAS EXACT" in note and "« الواحد »" in note and "« الصمد »" in note and "ne dis jamais" in note

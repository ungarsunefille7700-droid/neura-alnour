"""Hadiths attributed without a number, opinions of scholars, fatwas, consensus and the schools of fiqh.
Each case comes from the errors seen in the answers of the app (series 1 to 4) or from the authorised list of tests."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import neura_religion as r  # noqa: E402


def found(answer, question="", kind=None):
    out = r.verify(answer, r.prepare(question or answer, force=True), question)
    return [f for f in out if kind is None or f.kind in kind]


def errors(answer, question="", kind=None):
    return [f for f in found(answer, question, kind) if f.level == "error"]


ATT = ("attribution", "parole", "invention")


# ------------------------------------------------------------ hadiths without a number
def test_authentic_hadith_without_number_is_confirmed_in_both_collections():
    answer = "« Les actions ne valent que par les intentions et chacun n'aura que ce qu'il a eu l'intention de faire. » (rapporté par al-Bukhârî et Muslim)"
    out = found(answer, kind=ATT)
    assert len([f for f in out if f.level == "ok"]) == 2, [f.message for f in out]


def test_authentic_hadith_worded_differently_is_not_rejected():
    for answer in [
        "Le Prophète ﷺ a dit : « Que celui qui croit en Allah et au Jour dernier dise du bien ou se taise. » (Rapporté par al-Bukhârî et Muslim)",
        "Dans un hadith rapporté par al-Bukhârî et Muslim : « Celui qui ment contre moi délibérément, qu'il prépare sa place en Enfer. »",
        "Le Prophète ﷺ a dit : « L'affaire du croyant est étonnante ! Tout ce qui lui arrive est un bien pour lui, et cela n'appartient "
        "qu'au croyant. Si un malheur l'atteint, il patiente et c'est un bien pour lui. » Source : rapporté par Muslim.",
    ]:
        assert not errors(answer, kind=ATT), [f.message for f in found(answer, kind=ATT)]


def test_false_attribution_to_muslim_is_caught():
    # Muslim has other hadiths with « meilleur » and « Coran »: flagged with the right collection, to be checked
    answer = "« Le meilleur d'entre vous est celui qui apprend le Coran et l'enseigne » (rapporté par Muslim)."
    out = [f for f in found(answer, kind=ATT) if f.level != "ok"]
    assert out and "al-Bukhârî n°5027" in out[0].message
    # Muslim n°2626 is close (« rencontrer ton frère avec un visage souriant »), at-Tirmidhî has the text: to be checked
    out = [f for f in found("« Ton sourire face à ton frère est une aumône » (rapporté par Muslim).", kind=ATT) if f.level != "ok"]
    assert out and "at-Tirmidhî" in out[0].message
    # nothing of it in al-Bukhârî, all of it in at-Tirmidhî: the reference is corrected (the saying is authentic)
    answer = "« Ton sourire face à ton frère est une aumône » (rapporté par al-Bukhârî)."
    out = errors(answer, kind=ATT)
    assert out and r.neutralise(answer, out) == "« Ton sourire face à ton frère est une aumône » (rapporté par at-Tirmidhî (n°1970) [référence corrigée])."


def test_a_hadith_of_muslim_translated_differently_is_not_an_error():
    answer = "« Celui qui croit en Allah et au Jour dernier, qu'il honore son voisin. » Source : Sahih al-Bukhari et Sahih Muslim."
    assert not errors(answer, kind=ATT), [f.message for f in found(answer, kind=ATT)]


def test_false_attribution_to_bukhari_is_caught_and_the_reference_corrected():
    answer = "Le Prophète ﷺ a dit : « Ton sourire face à ton frère est une aumône. » (Bukhârî)"
    out = errors(answer, kind=ATT)
    assert out and out[0].kind == "attribution"
    fixed = r.neutralise(answer, out)
    # the authentic saying is kept, with the collection where it really is
    assert "Ton sourire face à ton frère est une aumône" in fixed and "at-Tirmidhî (n°19" in fixed and "Bukhârî" not in fixed


def test_the_long_version_of_another_collection_is_not_confirmed():
    # Bukhârî n°9 has the short version; « la plus élevée… la plus basse… » is the version of Muslim n°35
    answer = ("Hadith de Bukhârî : « La foi comporte soixante-dix et quelques branches. La plus élevée est de dire : il n'y a de "
              "divinité qu'Allah, et la plus basse est d'écarter un obstacle du chemin. Et la pudeur est une branche de la foi. »")
    assert not [f for f in found(answer, kind=ATT) if f.level == "ok"]


def test_invented_text_attributed_to_a_collection_is_removed():
    answer = ("Voici un hadith : Le Prophète ﷺ a dit : « Celui qui plante un palmier chaque vendredi aura un palais en or au "
              "paradis. » (Muslim)\n\nPlantez des arbres, c'est une bonne action.")
    out = errors(answer, kind=ATT)
    assert out and out[0].kind == "invention"
    fixed = r.neutralise(answer, out)
    assert "palmier" not in fixed and "(Muslim)" not in fixed and "Le Prophète ﷺ a dit" not in fixed
    assert r.REMOVED_SAYING in fixed and "Plantez des arbres" in fixed  # the rest of the answer is kept


def test_invented_saying_without_collection_is_removed_even_with_a_warning():
    answer = "Le Prophète ﷺ a dit : « La maladie est un trésor caché du paradis pour le croyant patient et reconnaissant. »"
    out = errors(answer, kind=ATT)
    assert out and "trésor caché" not in r.neutralise(answer, out)
    # « à vérifier » is not enough: an invented saying is not kept as a saying of the Prophet ﷺ
    hedged = answer + " Cette parole est souvent citée, mais sa source reste à vérifier."
    assert "trésor caché" not in r.neutralise(hedged, errors(hedged, kind=ATT))
    # quoted to say that it is not authentic: kept, nothing is attributed
    corrected = ("On entend souvent : « La maladie est un trésor caché du paradis pour le croyant patient et reconnaissant. » "
                 "Ce n'est pas un hadith authentique : aucune source ne le rapporte.")
    assert not errors(corrected, kind=ATT)


def test_invented_text_given_with_a_number_is_removed_too():
    answer = "Le Prophète ﷺ a dit : « Celui qui plante un palmier chaque vendredi aura un palais en or au paradis. » (Muslim n°2432)"
    out = errors(answer)
    fixed = r.neutralise(answer, out)
    assert any(f.kind == "invention" for f in out) and "palmier" not in fixed and "2432" not in fixed


def test_several_hadiths_in_one_answer_are_each_judged():
    answer = ("1. « Les actions ne valent que par les intentions et chacun n'aura que ce qu'il a eu l'intention de faire. » "
              "(al-Bukhârî n°1)\n\n2. Le Prophète ﷺ a dit : « Celui qui plante un palmier chaque vendredi aura un palais en or "
              "au paradis. » (Muslim)\n\n3. « Le fort n'est pas celui qui terrasse les autres, mais celui qui se maîtrise dans la "
              "colère. » (al-Bukhârî n°6114)")
    out = found(answer)
    fixed = r.neutralise(answer, errors(answer))
    assert [f.level for f in out if f.kind == "hadith"] == ["ok", "ok"]
    assert "intentions" in fixed and "se maîtrise dans la colère" in fixed and "palmier" not in fixed


def test_an_arabic_hadith_is_found_in_arabic():
    answer = "Rapporté par Muslim : « إنما الأعمال بالنيات وإنما لكل امرئ ما نوى »"
    out = found(answer, kind=ATT)
    assert out and out[0].level == "ok", [f.message for f in out]


def test_weak_hadith_called_authentic_without_number_is_caught():
    answer = "« La recherche de la science est une obligation pour tout musulman » est un hadith authentique rapporté par Ibn Mâjah."
    assert any("faible" in f.message for f in errors(answer))


def test_unconfirmable_attributions_are_flagged_not_rejected():
    out = found("« Le meilleur des gens est le plus utile aux gens » (rapporté par at-Tabarânî).", kind=ATT)
    assert out and all(f.level == "warn" for f in out)
    out = found("« Le paradis est sous les pieds des mères » : ce hadith n'est pas dans Sahih al-Bukhârî.", kind=ATT)
    assert not [f for f in out if f.level == "error"]


def test_correct_numbered_reference_after_another_collection_is_kept():
    answer = ("Non, ce hadith n'est pas rapporté dans Sahih Muslim.\n\nIl apparaît dans les recueils suivants :\n\n"
              "- **Abû Dâwûd n° 1452** – « Le meilleur d'entre vous est celui qui apprend le Coran et l'enseigne. »")
    refs = r.hadith_refs(answer)
    assert [(x.book, x.number) for x in refs] == [("abudawud", "1452")]
    assert not errors(answer, kind=("hadith",))


def test_references_in_tables_and_abi_dawud_are_found():
    table = "| Recueil | Numéro |\n|---|---|\n| **Sahih al-Bukhârî** | 3322 |\n| **Sunan Ibn Mâjah** | 3649 |"
    assert [(x.book, x.number) for x in r.hadith_refs(table)] == [("bukhari", "3322"), ("ibnmajah", "3649")]
    answer = "« La clé de la prière est la purification. » Recueil : Sunan Abi Dawud (n°659)."
    assert [(x.book, x.number) for x in r.hadith_refs(answer)] == [("abudawud", "659")]
    assert errors(answer, kind=("hadith",))  # n°659 is about praying on a mat (the right one is n°61)


def test_wrong_narrator_without_number_is_flagged():
    answer = "Rapporté par Aïcha : « Les actions ne valent que par les intentions et chacun n'aura que ce qu'il a eu l'intention de faire » (al-Bukhârî)."
    assert any("rapporteur" in f.message for f in found(answer, kind=ATT) if f.level != "ok")


# ------------------------------------------------------------ scholars, fatwas
def test_grade_of_a_scholar_is_compared_with_the_base():
    rows = r.hadith("tirmidhi", "2317")
    albani = [g[1] for g in rows[0]["g"] if "Albani" in g[0]]
    assert albani
    good = f"Ce hadith (at-Tirmidhî n°2317) est jugé {albani[0]} selon al-Albânî."
    assert any(f.kind == "avis" and f.level == "ok" for f in found(good))
    bad = "Ce hadith (at-Tirmidhî n°2317) est jugé faible (daif) selon al-Albânî." if r._grade_kind(albani[0]) == "authentique" \
        else "Ce hadith (at-Tirmidhî n°2317) est jugé authentique selon al-Albânî."
    assert any(f.kind == "avis" for f in errors(bad))


def test_fatwa_numbers_are_never_presented_as_verified():
    answer = "Selon la fatwa n°12345 d'IslamWeb, le tabac est interdit."
    out = errors(answer, kind=("fatwa",))
    assert out and "[numéro non vérifié]" in r.neutralise(answer, out)
    assert not errors("Je ne peux pas vérifier la fatwa n°12345 d'IslamWeb : l'application n'a aucune base de fatwas.", kind=("fatwa",))


def test_word_for_word_quotation_of_a_scholar_is_not_presented_as_exact():
    assert errors("Ibn Taymiyya a dit, mot pour mot : « La musique est le vin des âmes. »", kind=("citation",))
    out = found("Ibn Taymiyya a écrit : « La musique est le vin des âmes. »", kind=("citation",))
    assert out and out[0].level == "warn"


def test_opinions_of_scholars_are_flagged_as_to_be_confirmed():
    out = found("Selon Ibn Bâz, il est préférable de prier en groupe à la mosquée.", kind=("avis",))
    assert out and out[0].level == "warn"


# ------------------------------------------------------------ consensus, schools
def test_invented_consensus_on_a_divergence_is_caught():
    out = errors("Il y a consensus des savants : il faut croiser les mains sur la poitrine pendant la prière.", kind=("fiqh",))
    assert out and "malikite" in out[0].message


def test_real_divergence_and_real_consensus_are_accepted():
    assert not errors("Il n'y a pas de consensus sur la position des mains pendant la prière : les malikites laissent les bras "
                      "le long du corps, les autres écoles posent la main droite sur la gauche.", kind=("fiqh",))
    out = found("Il y a consensus des savants sur l'obligation des cinq prières quotidiennes.", kind=("fiqh",))
    assert out and out[0].level == "ok"


def test_unknown_consensus_is_flagged():
    out = found("Les savants sont unanimes : il est interdit de porter une montre en or blanc.", kind=("fiqh",))
    assert out and out[0].level == "warn"


def test_an_opinion_presented_as_an_obligation_for_all_is_caught():
    assert errors("Le qunût est obligatoire à la prière du Fajr.", kind=("fiqh",))
    assert errors("Toucher une femme annule les ablutions.", kind=("fiqh",))
    assert not errors("Selon les chaféites, le qunût est une sunna à la prière du Fajr ; les hanafites ne le font pas.", kind=("fiqh",))
    assert not errors("Le qunût n'est pas obligatoire à la prière du Fajr.", kind=("fiqh",))


def test_fiqh_questions_are_answered_with_the_positions_of_the_schools():
    context = r.prepare("Quelle école permet de donner la zakat al-fitr en argent ?").context
    assert "hanafites" in context
    context = r.prepare("Quel est l'avis exact d'Ibn Taymiyya sur la musique ? Donne sa fatwa mot pour mot.").context
    assert "ni base de fatwas" in context


def test_personal_cases_are_sent_to_a_qualified_person():
    question = "Mon mari et moi voulons divorcer et nous avons des enfants : que dit exactement la charia dans mon cas ?"
    assert "Situation personnelle" in r.prepare(question).context
    out = found("En islam, le divorce obéit à des règles précises.", question, kind=("relecture",))
    assert out and "relecture" in r.note(out)


def test_requests_without_religion_are_not_touched():
    assert not r.prepare("Écris une fonction Python qui inverse une chaîne de caractères.").active
    assert not r.prepare("Combien font 25 % de 360 ?").active


def test_an_authentic_text_under_a_wrong_number_gets_its_real_reference():
    answer = "Texte du hadith n°4521 de Muslim :\n\n> « Celui qui croit en Allah et au Jour dernier, qu'il dise du bien ou qu'il se taise. »"
    fixed = r.neutralise(answer, errors(answer))
    assert "4521" not in fixed and "qu'il dise du bien ou qu'il se taise" in fixed and "ce texte se trouve dans" in fixed


def test_an_invented_text_under_a_nonexistent_number_is_removed():
    answer = "Le hadith n°4521 de Muslim dit : « Celui qui plante un palmier chaque vendredi aura un palais en or au paradis. »"
    fixed = r.neutralise(answer, errors(answer))
    assert "palmier" not in fixed and r.REMOVED_SAYING in fixed


def test_the_position_given_to_a_school_is_compared_with_the_fiqh_file():
    wrong = "Selon les hanafites, toucher une femme annule les ablutions."
    assert errors(wrong, kind=("fiqh",))
    right = ("Pour les chaféites, toucher une femme annule les ablutions ; pour les hanafites, cela ne les annule pas ; "
             "les malikites et les hanbalites posent la condition du désir.")
    assert not errors(right, kind=("fiqh",))
    assert errors("Les hanafites ne permettent pas de donner la zakat al-fitr en argent.", kind=("fiqh",))
    assert not errors("L'école hanafite permet de donner la zakat al-fitr en argent ; les trois autres écoles demandent de la "
                      "nourriture.", kind=("fiqh",))
    assert not errors("Au Fajr, les hanafites ne font le qunût qu'en cas de calamité.", kind=("fiqh",))


def test_a_complex_question_answered_with_the_schools_is_not_rejected():
    answer = ("La question du witr est discutée : l'école hanafite le considère comme obligatoire (wâjib), alors que les "
              "malikites, les chaféites et les hanbalites le considèrent comme une sunna fortement recommandée. Dans tous les "
              "cas, il ne faut pas le délaisser.")
    assert not errors(answer)


def test_volume_and_page_of_a_work_are_not_presented_as_exact():
    answer = "Ibn Taymiyya l'explique dans Majmû' al-Fatâwâ, tome 11, p. 576."
    out = errors(answer, kind=("citation",))
    assert out and "[tome et page non vérifiés]" in r.neutralise(answer, out)
    assert not errors("Ibn Taymiyya en parle dans Majmû' al-Fatâwâ (le tome et la page restent à vérifier : tome 11, p. 576).",
                      kind=("citation",))


def test_an_unknown_work_attributed_to_a_scholar_is_flagged():
    out = found("Ibn Bâz l'a écrit dans son livre Les Secrets de la Prière Lumineuse.", kind=("citation",))
    assert out and out[0].level == "warn"
    assert not [f for f in found("An-Nawawî le rapporte dans son livre Riyâd as-Sâlihîn.", kind=("citation",)) if f.level != "ok"]


def test_the_fiqh_file_is_consistent_with_the_checker():
    data = r.fiqh()
    assert len(data["sujets"]) == 29  # 18 divergences, 11 consensus
    for item in data["sujets"] + r.fiches()["fiches"]:
        assert not [f for f in r._fiqh_findings(item["texte"], "") if f.level == "error"], item["id"]
    for item in data["sujets"]:
        for school, said in (item.get("positions") or {}).get("ecoles", {}).items():
            assert school.rstrip("e")[:5] in r.fold(item["texte"]) and said in ("oui", "non"), item["id"]


# ------------------------------------------------------------ cases seen in the real answers (Groq/Qwen test run, 2026-10-21)
def test_a_negation_of_the_collection_is_not_corrected():
    answer = ("Je ne peux pas confirmer que ce hadith se trouve dans Sahih al-Bukhârî. Il est rapporté par at-Tirmidhî : "
              "« Ton sourire face à ton frère est une aumône ».")
    assert not errors(answer, "Le hadith « Ton sourire face à ton frère est une aumône » est dans Sahih al-Bukhârî ?", kind=ATT)


def test_a_fatwa_number_that_the_answer_refuses_to_quote_is_not_flagged():
    answer = ("Je ne peux pas citer cette fatwa spécifique car aucune source vérifiée ne figure dans mon contexte actuel pour "
              "confirmer l'existence, le numéro ou le contenu exact d'une « fatwa n°12345 » d'IslamWeb concernant le tabac.")
    assert not errors(answer, kind=("fatwa",))


def test_agreements_that_are_not_a_consensus_of_scholars():
    for answer in ["Si elle remplit les conditions de la monnaie selon le fiqh (consensus sur sa valeur, acceptation), certains "
                   "savants pourraient la considérer comme licite.",
                   "Vous pouvez demander une convention de divorce si les deux parties sont d'accord.",
                   "Non, le witr n'est pas obligatoire de la même manière pour toutes les écoles."]:
        assert not [f for f in found(answer, kind=("fiqh",)) if f.level != "ok"], answer


def test_inverted_schools_in_a_list_are_caught():
    answer = ("1. Joindre les mains (Qabd) :\n- C'est la position des écoles hanafite et hanbalite.\n\n"
              "2. Laisser les mains pendantes (Ifradh) :\n- C'est la position de l'école Shafi'ite.")
    out = errors(answer, "Y a-t-il un consensus sur la position des mains pendant la prière ?", kind=("fiqh",))
    assert out and "chafeite" in out[0].message
    answer_malekite = "École Malékite : le qunût du Fajr n'est pas pratiqué, sauf en cas de calamité."
    assert errors(answer_malekite, "Le qunût au Fajr est-il obligatoire ?", kind=("fiqh",))


def test_a_wrong_verse_is_not_replaced_by_an_uncertain_one():
    answer = "Sourate Al-Ma'arij (70:24-25) : « Et vous préférez la vie d'ici-bas, tandis que la vie de l'au-delà est meilleure et plus durable. »"
    out = [f for f in errors(answer) if f.kind == "traduction"]
    assert out and "[référence corrigée]" not in r.neutralise(answer, out) and "non conforme" in r.neutralise(answer, out)


def test_a_number_written_after_its_collection_in_a_list():
    answer = "Il est rapporté dans :\n* **Sahih al-Bukhari** (n° 5027)\n* **Sunan Abi Dawud** (n° 1452)\n* **Sunan Ibn Majah** (n° 211)"
    assert [(x.book, x.number) for x in r.hadith_refs(answer)] == [("bukhari", "5027"), ("abudawud", "1452"), ("ibnmajah", "211")]

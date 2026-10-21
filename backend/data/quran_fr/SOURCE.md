# Traductions françaises du sens du Coran — source et conditions

Fichiers copiés **sans aucune modification** depuis QuranEnc.com (Encyclopédie du Noble Coran), le 2026-10-21 :

| Fichier | Traduction | Version | SHA-256 |
|---|---|---|---|
| `french_rashid.sqlite` | Traduction des sens du Noble Coran en français — Rachid Maach | 1.0.3 | 1c8d1f66f3ab8d708ba84db79b8c069dede23a3e40fff253d3ca14deafba87bf |
| `french_montada.sqlite` | Traduction française — Dr Nabil Rudwan, Noor International Center | 1.0.0 | 7a00139d1d145d015631f19c4a49f49ec668ee8d97edad74161245cb5f239149 |

Liste officielle (versions, dates) : `quranenc_versions.json` (https://quranenc.com/api/v1/translations/list/fr).

## Conditions de QuranEnc (« Terms and Policies », page de la traduction, relevées le 2026-10-21)
« Contents of the translations can be downloaded and re-published, with the following terms and conditions:
1. No modification, addition, or deletion of the content.
2. Clearly referring to the publisher and the source (QuranEnc.com).
3. Mentioning the version number when re-publishing the translation.
4. Keeping the transcript information inside the document.
5. Notifying the source (QuranEnc.com) of any note on the translation.
6. Updating the translation according to the latest version issued from the source (QuranEnc.com).
7. Inappropriate advertisements must not be included when displaying translations of the meanings of the Noble Quran. »

Aucune restriction d'usage commercial n'est indiquée dans ces conditions.

## Comment Neura Al Noor les utilise
- Les fichiers restent intacts (ni ajout, ni suppression, ni modification ; notes des traducteurs conservées).
- Usage principal : vérifier qu'une traduction française citée dans une réponse correspond bien au verset indiqué
  (comparaison en mémoire, le fichier n'est pas modifié).
- Quand un verset est montré à l'utilisateur, son texte est reproduit tel quel avec : le nom du traducteur,
  « QuranEnc.com » et le numéro de version.
- Mise à jour (condition 6) : vérifier régulièrement `quranenc_versions.json` et remplacer les fichiers par la dernière
  version publiée (même nom de fichier), puis relancer `tests/test_neura_quran_fr.py`.
- Remarque sur une traduction (condition 5) : à envoyer à QuranEnc.com (formulaire « Contact Us »).

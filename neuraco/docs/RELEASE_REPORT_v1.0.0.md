# Rapport de release NeuraCo 1.0.0

Date : 2026-08-01

## Artefact final

- Fichier : `NeuraCo-Setup-v1.0.0.exe`
- Taille : 124 363 609 octets
- SHA-256 : `A413BFB3ACB4508CC255C539EFC485DB20B4BA2150B54FA107CC2D68B16BCF02`
- Produit Windows : `NeuraCo`
- Version produit : `1.0.0`
- Societe : `NEURA AL-NOUR`
- Architecture : Windows x64
- Format : installateur NSIS autonome
- Signature : `NotSigned`

## Controles executes

- 78 fichiers de tests et 298 tests NeuraCo reussis.
- Audit complet npm : 0 vulnerabilite.
- Build Electron, CLI, SDK et renderer reussi.
- Preload Electron regroupe dans un fichier autonome compatible avec le sandbox.
- Aucun fichier `*.test.js`, `.env`, certificat ou jeton sensible dans les sorties.
- Contenu ASAR inspecte : version 1.0.0, point d'entree et 12 dependances de production presents.
- Backend public `/api/health` : HTTP 200.
- Site public : HTTP 200.
- Installation reelle depuis l'EXE : code retour 0.
- Lancement depuis le dossier installe : fenetre NeuraCo affichee.
- Controle visuel : veritable ecran de connexion NeuraCo charge par le preload securise.
- Desinstallation reelle : code retour 0, dossier d'installation supprime, aucun processus restant.
- Hash du fichier final identique au manifeste et a `SHA256SUMS.txt`.

## Correction trouvee pendant le test installe

Le premier paquet chargeait le mode d'aperçu du renderer car le preload sandboxe dependait encore d'un module local CommonJS. Le pipeline regroupe maintenant `electron/preload.ts` avec esbuild. Le controle de release refuse aussi tout preload contenant encore un `require("./...")` local. Le nouvel installateur affiche le veritable ecran d'authentification, ce qui prouve que l'API IPC de bureau est chargee.

## Limite connue

Le certificat Authenticode n'est pas disponible. L'installateur gratuit pour GitHub Releases fonctionne mais Windows SmartScreen peut afficher un avertissement. Le build officiel signe reste separe et conserve `forceCodeSigning: true`.

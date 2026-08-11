# NeuraCo 1.0.10

## FiveM

- Detection des deux installations Windows courantes de FiveM : le lanceur autonome et le lanceur contenu dans `FiveM.app`.
- Generation FiveM guidee par des questions de cadrage, puis production de ressources multi-fichiers completes et installables.
- Validation locale de `fxmanifest.lua`, des scripts, des fichiers NUI et des chemins references avant export.

## Fichiers et ZIP

- Ecriture reelle des fichiers proposes uniquement apres examen et confirmation.
- Export ZIP du projet actif avec empreinte SHA-256.
- Exclusion automatique des secrets, fichiers `.env`, dependances, metadonnees Git et liens symboliques.

## Outils Windows

- Detection locale verifiee de FiveM et Blender.
- Inspection d'une scene Blender 5.1.2 et export GLB valides avec une scene temporaire.
- Controle Windows limite aux applications autorisees, au projet ouvert et aux actions confirmees.

## Verification

- Suite NeuraCo complete, builds Electron/CLI/SDK/interface et controles de securite executes avant publication.
- Backend NeuraCo et contrat de generation FiveM testes.
- Application Windows empaquetee demarree en auto-test avant publication.

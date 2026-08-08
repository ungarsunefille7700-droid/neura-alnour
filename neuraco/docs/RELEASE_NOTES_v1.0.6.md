# NeuraCo 1.0.6

## Projets locaux

- Creation d'un nouveau projet depuis la barre laterale.
- Validation des noms de dossiers compatibles Windows.
- Refus des noms reserves, chemins dangereux et doublons.
- Choix du dossier parent dans la boite de dialogue Windows.
- Ouverture et indexation immediates du projet cree.

## Depots Git

- Clonage reel d'un depot Git HTTPS depuis NeuraCo.
- Compatibilite avec GitHub, GitLab et les serveurs Git HTTPS.
- Refus des URL contenant des identifiants ou mots de passe.
- Nettoyage du dossier temporaire si le clonage echoue.
- Ouverture et indexation uniquement apres la fin complete du clonage.

## Securite et verification

- DOMPurify mis a jour vers la version corrigee 3.4.13.
- Audit de production strict avec exception temporaire limitee aux deux avis
  `image-size` sans version corrigee, dependance transitive non utilisee par le
  flux PowerPoint actuel sans images.
- Clone reseau reel verifie avec le depot public `octocat/Hello-World`.
- 80 fichiers de test et 310 tests reussis.
- Build Electron, CLI, SDK et interface controle avant publication.

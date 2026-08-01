# NeuraCo 1.0.5

## Correctif

- Le chat d'accueil fonctionne maintenant sans ouvrir de dossier local.
- Une conversation generale reste strictement isolee des fichiers et images du projet.
- Les demandes liees a un dossier conservent la verification stricte du projet actif.
- L'annulation d'une conversation generale fonctionne egalement sans projet ouvert.

## Verification

- Envoi reel depuis l'application Electron sans projet ouvert jusqu'au backend de production.
- Reponse reelle recue dans l'interface avec Claude Sonnet 4.5 via Anthropic.
- Le test refuse explicitement l'ajout d'un fichier local en mode conversation generale.
- 79 fichiers de test et 305 tests reussis.
- Build Electron, CLI, SDK et interface controle avant publication.

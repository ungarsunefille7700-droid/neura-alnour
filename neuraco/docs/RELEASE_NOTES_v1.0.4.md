# NeuraCo 1.0.4

## Correctif

- La restauration de session ne peut plus rester bloquee indefiniment.
- Les controles serveur d'authentification expirent proprement apres 12 secondes.
- L'interface quitte toujours l'ecran de connexion securisee apres 15 secondes maximum.
- Une erreur reseau conserve la session chiffree et propose une nouvelle tentative.
- L'ecriture du journal de connexion ne bloque plus l'ouverture de l'application.

## Verification

- Serveur silencieux simule : sortie controlee du chargement et nouvelle tentative disponible.
- Backend de production : session restauree en environ 3,17 secondes lors du test final.
- Tests Electron et interface reussis.
- Build Electron, CLI, SDK et interface controle avant publication.

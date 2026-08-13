# NeuraCo v1.0.12

## Fiabilite du demarrage

- Reveille le backend en arriere-plan au lancement de NeuraCo et au debut d'une connexion Google.
- Limite le reveil a huit secondes sans bloquer l'interface ni utiliser de credits IA.

## Catalogue des modeles

- Limite a douze secondes la recuperation de la politique serveur authentifiee.
- Retente automatiquement le chargement du catalogue apres une indisponibilite temporaire du backend.
- Remplace le catalogue de secours par le catalogue complet du serveur des que le backend redevient disponible, sans redemarrer NeuraCo.

## Verification

- 330 tests NeuraCo valides.
- 75 tests backend NeuraCo valides.
- Compilation Electron, CLI, SDK et interface validee.
- Controle de securite de la release et absence de secrets integres valides.

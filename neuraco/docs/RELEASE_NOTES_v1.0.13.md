# NeuraCo v1.0.13

## Compositeur déverrouillé

- Le champ de demande, les réglages Modèle/Effort/Vitesse et le menu d’ajout restent utilisables pendant une réponse IA.
- Le bouton d’envoi devient un bouton d’arrêt pendant la génération et interrompt uniquement la requête active.
- Une ouverture de flux bloquée est interrompue après 30 secondes.
- Un flux ouvert mais silencieux est interrompu après 60 secondes d’inactivité.
- Après une annulation ou une expiration, le compositeur revient automatiquement à son état normal.

## Vérifications

- Tests ciblés des flux suspendus et de l’annulation depuis l’interface.
- Suite NeuraCo complète, build Electron/CLI/SDK/React et audit de publication validés.

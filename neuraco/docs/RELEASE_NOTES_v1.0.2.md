# NeuraCo 1.0.2

Cette mise a jour corrige le parcours de connexion et de creation de compte dans l'application Windows.

## Correctifs

- Le formulaire de connexion et le formulaire d'inscription defilent correctement, meme sur une fenetre de faible hauteur.
- Les boutons de validation et le lien de recuperation du mot de passe restent accessibles.
- Le retour de connexion Google utilise desormais la route Web NeuraCo publiee.
- Une tentative Google interrompue ne peut plus garder l'application bloquee pendant cinq minutes.
- Le demarrage de Google depuis le site n'attend plus inutilement huit secondes avant la redirection.
- Les trois adresses fondateur demandees obtiennent l'acces Neura Ultra et NeuraCo cote serveur.

## Securite

- L'inscription, la connexion Google et la recuperation du mot de passe passent toujours par le backend Neura Al-Nour.
- Aucun mot de passe, jeton, secret serveur ou cle API n'est inclus dans l'installateur.
- L'autorisation NeuraCo reste verifiee cote serveur avant l'ouverture du workspace.

## Installation

Telechargez `NeuraCo-Setup-v1.0.2.exe`, verifiez le fichier `SHA256SUMS.txt`, puis ouvrez l'installateur. Aucun runtime supplementaire n'est necessaire.

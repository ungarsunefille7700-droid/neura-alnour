# NeuraCo

NeuraCo est une application Windows de travail et de developpement assiste par IA. Elle regroupe dans une interface locale l'exploration de projets, la conversation, l'edition de fichiers, le terminal, Git, la revue des modifications, les checkpoints et les agents.

## Installation Windows

Configuration prise en charge pour cette premiere version :

- Windows 10 ou Windows 11 en 64 bits ;
- connexion Internet pour l'authentification et les fonctions IA ;
- compte Neura Al-Nour disposant de l'acces NeuraCo.

1. Telechargez `NeuraCo-Setup-v1.0.0.exe` depuis la page GitHub Releases officielle.
2. Comparez son SHA-256 avec `SHA256SUMS.txt`.
3. Ouvrez l'installateur et choisissez le dossier d'installation.
4. Lancez NeuraCo depuis le Bureau ou le menu Demarrer.
5. Connectez-vous avec votre compte Neura Al-Nour.

Node.js, Python et les dependances npm ne sont pas requis sur le PC de l'utilisateur. Le runtime Electron et les dependances de production sont inclus dans l'installateur.

### Avertissement Windows SmartScreen

Le paquet GitHub gratuit genere par `npm run dist:github` n'est pas signe numeriquement tant qu'aucun certificat Authenticode officiel n'est disponible. Windows peut donc afficher SmartScreen. Verifiez toujours le SHA-256 publie avant de continuer. Le build officiel `npm run dist:win` conserve l'obligation de signature et refuse une distribution finale non signee.

## Utilisation

1. Ouvrez un dossier de projet depuis l'accueil.
2. Decrivez la tache dans la conversation.
3. Examinez le plan et les autorisations demandees.
4. Controlez les fichiers lus et modifies.
5. Lancez les tests depuis le terminal integre.
6. Examinez les differences avant de les accepter.
7. Utilisez un checkpoint ou le rollback si necessaire.

Les operations sensibles restent soumises aux permissions et confirmations de NeuraCo.

## Donnees et secrets

- Aucune cle IA, cle Stripe, cle de base de donnees ou secret serveur n'est embarque dans l'application.
- NeuraCo contacte le backend HTTPS de Neura Al-Nour ; les secrets fournisseurs restent exclusivement sur ce serveur.
- Le jeton de session local est protege avec le stockage chiffre de Windows lorsqu'il est disponible.
- Les fichiers `.env`, certificats, logs et installateurs sont exclus de Git.
- Les projets personnels ne sont pas supprimes lors d'une mise a jour ou d'une desinstallation standard.

## Verification locale avant publication

Depuis le dossier `neuraco` :

```powershell
npm ci
npm run verify:release
npm run dist:github
```

`verify:release` execute les tests, l'audit des dependances, le build complet et le controle anti-secrets. `dist:github` produit ensuite un installateur NSIS x64 autonome et le paquet de publication dans `release-package/v1.0.0/`.

Pour un build officiel signe, configurez le certificat Authenticode uniquement dans l'environnement de build securise puis utilisez :

```powershell
npm run dist:win
```

Ne placez jamais le certificat ni son mot de passe dans le depot.

## Desinstallation

Ouvrez **Parametres Windows > Applications > Applications installees**, choisissez **NeuraCo**, puis **Desinstaller**. Les projets personnels situes hors du dossier de donnees NeuraCo ne sont jamais supprimes par l'installateur.

## Documentation de publication

Les fichiers et etapes de GitHub Releases sont detailles dans [`docs/GITHUB_RELEASE.md`](docs/GITHUB_RELEASE.md).

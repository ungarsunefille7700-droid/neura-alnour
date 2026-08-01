# Publication de NeuraCo sur GitHub Releases

Documentation officielle : [gestion des releases GitHub](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) et [`gh release create`](https://cli.github.com/manual/gh_release_create).

## Fichier principal

Le fichier destine aux utilisateurs est :

`release-package/v1.0.0/NeuraCo-Setup-v1.0.0.exe`

Publier egalement `SHA256SUMS.txt`. `release-manifest.json` est recommande pour conserver les metadonnees techniques. Le fichier `.blockmap` est utile pour les futures mises a jour, mais il n'est pas indispensable a une installation manuelle.

## Contenu du depot Git

Le depot doit contenir le code source NeuraCo et sa configuration reproductible :

- `neuraco/electron/`
- `neuraco/src/`
- `neuraco/cli/`
- `neuraco/sdk/`
- `neuraco/extensions/`
- `neuraco/public/`
- `neuraco/build/icon.ico`
- `neuraco/scripts/`
- `neuraco/docs/`
- `neuraco/package.json`
- `neuraco/package-lock.json`
- les fichiers TypeScript/Vite et electron-builder ;
- `neuraco/README.md` et les `.gitignore`.

Dans le depot Neura Al-Nour existant, conserver aussi les routes backend et la carte frontend deja utilisees par NeuraCo. Les fichiers `.env` de ces deux applications restent exclus ; seules des configurations d'exemple sans secret peuvent etre publiees.

## Fichiers interdits dans Git

Ne jamais ajouter :

- `.env`, `.env.*` sauf un exemple sans valeur reelle ;
- cles API, tokens, mots de passe ou chaines de connexion ;
- certificats `*.pfx`, `*.p12`, `*.pem`, `*.key`, `*.crt`, `*.cer` ;
- `node_modules/` ;
- `dist*`, `release*`, caches et logs ;
- donnees locales utilisateur et jetons de session ;
- installateurs `.exe` ou `.msi` dans l'historique Git.

Les binaires sont joints a une GitHub Release, pas commites dans le depot.

## Construction verifiee

```powershell
cd neuraco
npm ci
npm run dist:github
```

La commande s'arrete si les tests echouent, si npm detecte une vulnerabilite de production importante, si le build echoue, si un fichier de test entre dans la distribution ou si une chaine ressemble a un secret.

## Creation de la release dans l'interface GitHub

1. Pousser uniquement les fichiers source controles sur la branche `main`.
2. Ouvrir le depot GitHub puis **Releases**.
3. Choisir **Draft a new release**.
4. Creer le tag `v1.0.0` depuis le commit valide de `main`.
5. Saisir le titre `NeuraCo 1.0.0`.
6. Coller le contenu de `docs/RELEASE_NOTES_v1.0.0.md` dans la description.
7. Joindre depuis `release-package/v1.0.0/` :
   - `NeuraCo-Setup-v1.0.0.exe` ;
   - `SHA256SUMS.txt` ;
   - `release-manifest.json` ;
   - facultativement `NeuraCo-Setup-v1.0.0.exe.blockmap`.
8. Laisser la release en brouillon le temps de telecharger a nouveau l'EXE et de comparer son hash.
9. Publier la release uniquement apres cette verification.

## Creation avec GitHub CLI

Apres authentification de `gh` :

```powershell
git tag -a v1.0.0 -m "NeuraCo 1.0.0"
git push origin v1.0.0
gh release create v1.0.0 `
  "neuraco/release-package/v1.0.0/NeuraCo-Setup-v1.0.0.exe" `
  "neuraco/release-package/v1.0.0/SHA256SUMS.txt" `
  "neuraco/release-package/v1.0.0/release-manifest.json" `
  --title "NeuraCo 1.0.0" `
  --notes-file "neuraco/docs/RELEASE_NOTES_v1.0.0.md" `
  --draft
```

Verifier la release en brouillon, puis la publier depuis GitHub.

## Verification du hash telecharge

```powershell
Get-FileHash .\NeuraCo-Setup-v1.0.0.exe -Algorithm SHA256
```

La valeur doit etre strictement identique a celle de `SHA256SUMS.txt`.

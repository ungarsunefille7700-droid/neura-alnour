# NEURA AL-NOUR - Android App Bundle (AAB)

## Fichier AAB
- **Chemin**: `/app/android-twa/app-release.aab`
- **Taille**: ~155 KB
- **Package**: `com.neuraalnour.app`
- **Version**: 1.0.0 (versionCode: 1)
- **SDK minimum**: Android 7.0 (API 24)
- **SDK cible**: Android 14 (API 34)

## Keystore de signature
- **Chemin**: `/app/android-twa/neura-alnour.keystore`
- **Alias**: `neura-alnour`
- **Mot de passe store**: `NeuraAlNour2026!`
- **Mot de passe clé**: `NeuraAlNour2026!`
- **Validité**: 10 000 jours (~27 ans)
- **SHA-256**: `6D:B2:62:6F:A8:C9:BF:39:CE:CB:78:CC:42:EF:AA:26:AD:4F:8D:E6:A2:3A:B0:44:C6:C4:21:39:16:9C:46:BF`

## Digital Asset Links
Le fichier `assetlinks.json` est déjà déployé sur le site:
`https://noor-dev.preview.emergentagent.com/.well-known/assetlinks.json`

## IMPORTANT
- **Conservez le keystore** en lieu sûr! Il est nécessaire pour toutes les futures mises à jour sur Google Play.
- Si vous perdez le keystore, vous ne pourrez plus mettre à jour l'application sur Google Play.
- Pour les mises à jour, incrémentez `versionCode` et `versionName` dans `/app/android-twa/project/app/build.gradle`

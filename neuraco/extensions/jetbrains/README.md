# NeuraCo pour JetBrains

Plugin commun pour IntelliJ IDEA, PyCharm, WebStorm, Rider et les autres IDE
JetBrains qui fournissent `com.intellij.modules.platform`.

## Fonctionnement

- NeuraCo Desktop démarre un pont HTTP local lié uniquement à `127.0.0.1`.
- Un jeton aléatoire est écrit dans le profil Windows de l'utilisateur.
- Le plugin lit ce manifeste local et ne stocke aucune clé API.
- Les sessions, agents, règles, modèles et consommations restent gérés par
  NeuraCo Desktop.
- Le fichier actif peut être joint explicitement à une demande.
- Les réponses sont enregistrées dans le même fil que l'application Desktop.
- Toute requête est refusée lorsque NeuraCo Desktop est verrouillé ou déconnecté.

## Construction

Le projet utilise Java 21, Gradle 9 et IntelliJ Platform Gradle Plugin 2.x.

```powershell
.\gradlew.bat test buildPlugin
```

Le ZIP installable est produit dans `build/distributions`.

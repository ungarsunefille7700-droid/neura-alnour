# Neura Al Noor — Rapport d'intervention (14/10/2026)

Base de travail : archive `Neura-Al-Noor-Vercel-production-dpl_FQKp15WB9HC2oLDHoiaDKsxopVfS.zip` (frontend React/CRA uniquement).
L'archive originale n'a pas été modifiée. Le **rapport d'audit mentionné n'était pas joint** : les deux problèmes
décrits dans la mission ont été vérifiés, puis tout le frontend a été relu et chaque anomalie a été confirmée
dans le code (et, quand c'était possible, contre le backend de production) avant correction.

---

## A. Corrections prioritaires

### 1. Protection des routes — `src/App.js` → `src/components/ProtectedRoute.js`, `src/contexts/AuthContext.js`, `src/pages/AuthCallback.js`
- **Problème (confirmé)** : `ProtectedRoute` affichait la page dès que `location.state.user` existait, sans regarder le contexte d'auth.
  Tout code pouvant faire `navigate('/chat', { state: { user } })` — ou l'historique du navigateur rejoué après une déconnexion — ouvrait l'écran protégé.
- **Cause** : raccourci ajouté pour le retour Google (`AuthCallback` naviguait avec `state: { user }`).
- **Correction** : contournement supprimé ; l'accès dépend uniquement de `user` établi par `AuthContext`. `AuthCallback` n'envoie plus d'utilisateur dans l'état (le contexte est déjà renseigné par `setUserFromGoogle` avant la navigation).
- **Problèmes associés trouvés et corrigés** :
  - *Démarrage à froid Render* : `/auth/me` avait un délai de 20 s ; le démarrage à froid mesuré du backend est de **71 s**. Une erreur réseau mettait `user` à `null` → renvoi vers la connexion alors que le jeton était valide, sans nouvel essai. Désormais : délai 45 s, 2 tentatives, puis écran « Le serveur ne répond pas… Réessayer » qui **conserve** la session.
  - *Expiration de session en cours d'utilisation* : rien ne déconnectait l'utilisateur. Ajout d'un intercepteur axios : un **401** du backend pour le jeton courant ferme la session (les 403 de permission ne déconnectent pas). Les flux `fetch` (chat, Work, prof de langue) signalent aussi les 401.
  - *Course logout / réponse tardive* : une réponse `/auth/me` arrivant après une déconnexion ne réinstalle plus l'utilisateur.
- **Backend** : vérifié en réel, `POST /api/chat/stream` sans jeton → 401 ; jeton invalide → 401. Le serveur contrôle bien les autorisations de son côté.
- **Tests** : `src/components/ProtectedRoute.test.js` (8 tests : état forgé, historique rejoué, rechargement, jeton refusé, serveur injoignable + réessai, connexion/déconnexion, 401 en cours de session, 403). En réintroduisant l'ancien contournement, 3 tests échouent.
  Vérifié aussi dans le navigateur contre le backend de production (état forgé refusé, jeton invalide effacé → `/auth`).

### 2. Lecture des flux IA (SSE) — `src/pages/ChatPage.js`, `src/pages/LanguageTutorPage.js`, nouveau `src/utils/sseStream.js`
- **Problème (confirmé)** : les deux lecteurs de `ChatPage` (chat et Work) — et celui du prof de langue, identique — sortaient de la boucle à la fin du flux **sans traiter le tampon restant** ni vider le `TextDecoder`.
  Si le serveur fermait sans `\n\n` final, le dernier événement (souvent `done`) était perdu : pour Work, la réponse entière disparaissait (« empty work response ») ; pour le chat, la conversation n'était pas mise à jour.
- **Correction** : lecteur unique `readSseEvents` : traitement du dernier événement, vidage du décodeur (caractères arabes/accents coupés entre deux paquets), séparateurs `\r\n`, lignes `event:`/commentaires, arrêt et annulation propre du flux sur erreur.
- **Comportements ajoutés dans le chat** : un flux qui se coupe sans `done` n'affiche plus une réponse vide comme si elle était complète — le texte déjà reçu est conservé et marqué « Réponse incomplète » ; sinon le message en attente est retiré avec un message d'erreur en français (les messages techniques comme « Failed to fetch » ne sont plus montrés). Le détail renvoyé par le serveur (quota, 401…) est affiché. Après `done`, la conversation est rechargée depuis le serveur : pas de doublon (testé).
- **Prof de langue** : même correctif + bug confirmé en mode appel vocal (chaque tour vocal réutilisait la fonction de la première prise de rendu → `session_id: null` à chaque tour, contexte perdu). Corrigé par des références ; micro, voix et requête sont arrêtés en quittant la page ; langue verrouillée pendant une réponse.
- **Tests** : `src/utils/sseStream.test.js` (15 tests : événement complet, fragmenté, plusieurs événements, dernier événement sans séparateur, UTF-8 coupé, CRLF, pas de doublon, JSON incomplet, erreur serveur, coupure réseau, erreurs HTTP) et `src/pages/ChatPage.stream.test.js` (7 tests d'intégration du composant avec réseau simulé). En neutralisant le traitement du dernier événement, 5 tests échouent (2 unitaires + 3 d’intégration).

## B. Autres anomalies confirmées et corrigées

| Fichier | Problème initial | Cause | Correction |
|---|---|---|---|
| `pages/AuthPage.js`, `MultiplayerQuizPage.js`, `GamificationPage.js`, `FounderAdminPage.js` | Plantage React possible sur erreur de validation | `toast.error(detail)` avec `detail` = tableau d'objets (FastAPI 422 — **capturé sur le vrai backend** à l'inscription) | Utilisation de `apiErrorMessage` (déjà présent dans le projet). Test : `utils/apiError.test.js` avec la vraie réponse |
| `pages/AuthPage.js` | Boutons bloqués après « Retour » depuis Google | État restauré par le cache du navigateur | Réinitialisation sur `pageshow` |
| `pages/QuranPage.js` | Lecture auto : rejoue le verset 1 de l'**ancienne** sourate | `setTimeout(() => playAyah(1))` avec fermeture périmée | Lecture lancée après chargement de la nouvelle sourate ; audio précédent arrêté ; `play()` protégé |
| `pages/QuranPage.js` | `/quran/N` en échec affichait la liste sans explication | Pas d'état d'erreur | Écran chargement/erreur avec « Réessayer » |
| `components/PrayerNotificationManager.js` (+ `public/notification-sw.js`) | Aucun rappel de prière sur Android | `new Notification()` refusé par Chrome Android, erreur avalée | Repli via un service worker minimal (affichage de notifications uniquement, aucun cache) ; icône inexistante `/favicon.ico` remplacée |
| `PrayerNotificationManager.js`, `utils/notificationPreferences.js` | Nouvelle position ignorée jusqu'à minuit | Effet non relancé | Événement de changement de position |
| `pages/PrayerTimesPage.js` | Mention « position par défaut » effacée ; Paris écrasait une vraie position enregistrée | Nom de lieu réécrit ; sauvegarde du repli | Mention conservée (vérifié en réel), repli non enregistré |
| `pages/QiblahPage.js` | Flèche fausse sur Android, cap 0° iOS ignoré | `alpha` antihoraire utilisé comme cap ; événements relatifs mélangés | Cap = `360 − alpha` (événements absolus), `webkitCompassHeading` testé par type |
| `pages/DuasPage.js` | Faux « Erreur de lecture audio » en changeant de doua ; lecture continue après la page | `cancel()` déclenche `onerror` « interrupted » | Erreurs d'interruption ignorées, arrêt au démontage |
| `pages/RemindersPage.js` | Écran « Réessayer » jamais affiché si la vidéo échoue | L'erreur d'un `<source>` ne remonte pas au `<video>` | `onError` sur `<source>` |
| `pages/MosquesPage.js` | Bouton « Rechercher dans 20 km » inopérant à 20 km | `setRadius(20000)` sans effet | Bouton remplacé par un message à 20 km |
| `pages/QuizPage.js` | Question bloquée si l'envoi de réponse échoue ; quiz vide | Réponse sélectionnée jamais réinitialisée | Réessai possible ; quiz vide refusé proprement |
| `pages/MultiplayerQuizPage.js` | WebSocket ouverte après avoir quitté ; reconnexions infinies après fermeture de la page ; résultat d'une ancienne question | Pas de garde après `await` ; pas d'arrêt au démontage | Gardes démontage/sortie/401 ; résultat ignoré si la question a changé ; minuteur de réaction nettoyé |
| `pages/GamificationPage.js` | « Chargement des missions… » infini en cas d'erreur | Pas d'état d'erreur | Écran d'erreur + « Réessayer » ; coffre sans `reward` géré |
| `pages/FounderAdminPage.js` | Tableau de bord rempli de zéros si le chargement échoue ; résultats de recherche dans le désordre | Pas d'état d'erreur ; pas de garde de séquence | Écran d'erreur + réessai ; seule la dernière recherche est appliquée |
| `pages/DeveloperPage.js` | Statut inconnu affiché « Gratuit » ; sur mobile, pas d'historique ni de « Nouvelle demande » ; clic historique muet en erreur | Erreurs ignorées ; barre latérale `hidden md:flex` | « Statut indisponible » + réessai ; barre mobile (historique, nouvelle demande, accueil) ; message d'erreur |
| `pages/ChatPage.js`, `components/DevWorkspace.js` | Boutons de suppression invisibles sur écran tactile | `opacity-0 group-hover` | Visibles sous `md` |
| `pages/LandingPage.js` | Pas de choix de langue sur mobile ; menu mobile transparent illisible | Sélecteur seulement ≥ 1700 px ; `backdrop-filter` imbriqué inopérant | Sélecteur ajouté au menu mobile, fond opaque (vérifié en 375 px) |
| `pages/IslamLearningPage.js` | Choisir un autre thème ne lançait pas de leçon ; un appel en échec vidait toute la progression | Condition `messages.length === 0` ; `Promise.all` | Leçon lancée pour un nouveau thème ; chargements indépendants (`allSettled`) |
| `pages/LearnPage.js` | Division par zéro (barre NaN) pour une leçon d'une section | `length - 1 = 0` | `Math.max(1, …)` |
| `pages/MushafPage.js` | Champ « Page » impossible à vider ; chargement à chaque chiffre | `onChange` appliqué immédiatement | Valeur appliquée sur Entrée / perte de focus |
| `pages/SubscriptionPage.js` | Redirection vers `/undefined` si l'URL de paiement manque | Pas de contrôle | Contrôle + message d'erreur |
| `contexts/ThemeContext.js` | Plantage au démarrage si le stockage est bloqué | `localStorage` sans try/catch | Protégé |

Outillage de test (aucune dépendance ajoutée) : `craco.config.js` (alias `@` et résolution react-router 7 pour Jest uniquement), `src/setupTests.js` (TextEncoder/TextDecoder pour jsdom).

## C. Rapport des fonctionnalités

**Corrigées et testées (tests automatisés)** : protection des routes / session (connexion, déconnexion, rechargement, expiration, serveur injoignable) ; streaming chat ; streaming Work ; messages d'erreur API.

**Corrigées, vérifiées dans le navigateur contre le backend de production** : redirection des routes protégées, jeton invalide, horaires de prière (repli), page Coran en erreur, menu mobile + langue, Duas, Qibla (affichage), Mosquées, Quiz (écran d'accueil), Abonnements (affichage, pas de débordement à 375 px).

**Corrigées mais non testables ici** (nécessitent un compte, un appareil ou un service) : prof de langue en mode vocal, notifications Android, boussole Android/iOS, lecture auto du Coran (backend en panne, voir E), multijoueur (WebSocket authentifiée), Gamification, panel fondateur, page Développeur, Islam Learning connecté, vidéo de rappel en échec.

**Implémentées mais non testables** sans compte : conversation IA réelle, génération d'images, mode Work réel, mode Développeur, paiement Stripe, NeuraCo Connect, connexion Google (redirection externe Emergent).

**Déjà fonctionnelles, conservées sans modification** : retour de paiement (sondage avec annulation et 401 déjà corrects), NeuraCo Connect (401 déjà géré), pièces jointes images, quotas, Settings (interrupteurs bien câblés), Ramadan, Support, i18n.

## D. Tests réellement exécutés

```
npm ci --legacy-peer-deps                       → OK
CI=true npx craco test --watchAll=false (avant) → 5 suites, 25 tests, tous OK
CI=true npx craco test --watchAll=false (après) → 9 suites, 57 tests, tous OK
CI=true npx craco build                         → Compiled successfully (288,8 kB gzip)
ESLint (no-undef, jsx-no-undef, rules-of-hooks) → 0 erreur dans le code applicatif
```
Mutation : réintroduire l'ancien contournement d'auth → 3 tests échouent ; supprimer le traitement du dernier événement SSE → 5 tests échouent.
Limites : pas de test avec un compte réel (création de compte non effectuée volontairement) ; aucun formulaire soumis au backend de production.

## E. Points en suspens — traités le 14/10/2026 (2e passe)

Le code backend a été récupéré depuis le dépôt GitHub `ungarsunefille7700-droid/neura-alnour` (dernier commit `fcc10c3`).
⚠️ La production tourne sur la branche **`billing/stripe-production-20261009`** (vérifié : `POST /api/subscriptions/cancel`, qui n'existe que sur cette branche, répond 401 en production), et non sur `main`.
Toutes les corrections backend sont donc sur **`fix/production-chat-moderation-coran`**, construite sur cette branche de production (commits `5c620e3` et `a1d72ac`). **Ne pas utiliser** l'ancienne branche `fix/coran-mosquees-quiz-tarifs` (basée sur `main`) : la déployer ferait perdre les correctifs Stripe.

| # | Problème | Cause trouvée | Correction | Vérification |
|---|---|---|---|---|
| 1 | Toutes les sourates en erreur 500 | `http://api.alquran.cloud` redirige (301) vers `https://` ; `httpx` ne suit pas les redirections → JSON illisible | Appel direct en HTTPS (arabe + français en parallèle), 404 pour un numéro invalide | Fonction réelle extraite de `server.py`, contre la vraie API : sourates 1, 2, 114 OK (7/286/6 versets) |
| 2 | Mosquées : liste vide à Paris | Serveur Overpass principal saturé (504), erreur convertie en liste vide | Miroir Overpass, puis géocodeur Photon (OpenStreetMap) ; 503 + message français si tout échoue. Front : écran « Réessayer » au lieu de « aucune mosquée », réponses obsolètes ignorées | Réel : Overpass en panne pendant le test → Photon a trouvé 8 mosquées à moins de 5 km (Grande Mosquée de Paris…) ; cas « tout en panne » → 503 |
| 3 | Quiz en ~43 s | Génération Gemini 2.5 Flash sans limite de temps | Limite de 15 s, puis banque de questions intégrée (repli existant) | Doublure IA lente → quiz servi en 15,0 s ; IA rapide → questions générées conservées |
| 4 | Tarifs incohérents | Plus facturé 89,99 €/an (prix de Mongo), Développeur 119,99 €/an | Décision : règle « 10 × le mensuel » comme Mongo/Neura+/Ultra → **Plus 219,99 €/an, Développeur 199,99 €/an** (backend + affichage + test backend) | Le badge −16 % devient exact pour tous les plans |
| 5 | Adhan annoncé mais absent | Aucun audio | Adhan à l'heure exacte de chaque prière + **choix de la voix façon Mawaqit** (page Prières et Paramètres), bouton Écouter/Arrêter, notification « C'est l'heure de la prière » si autorisée, un seul Adhan par prière et par jour | 4 enregistrements libres de Wikimedia Commons (`public/audio/`, licences dans `public/audio/CREDITS.txt`, crédit affiché) ; lecture réelle vérifiée dans le navigateur ; 4 tests automatisés |

**Adhan selon la position de la personne** : quand l'Adhan est activé, l'app demande la localisation, calcule les horaires pour cette position, puis la revérifie à l'ouverture et toutes les 30 min (sans jamais redemander l'autorisation en arrière-plan). Un déplacement d'1 km ou plus reprogramme les prières du jour. Si la localisation est refusée : dernière position connue, sinon Paris, et l'utilisateur est prévenu. Tests : position utilisée pour les horaires, déplacement Casablanca → Lyon, aucune demande d'autorisation en arrière-plan.

Limite de l'Adhan : comme toute application web, il ne sonne que si l'application est ouverte (onglet ou application installée).
Les enregistrements de Mawaqit ne sont pas réutilisables (droits d'auteur).

Résultats : `CI=true npx craco test` → **10 suites, 63 tests réussis** ; build de production OK ; vérification backend → **12/12**.


### Réponses du chat doublées et rappel générique sur les insultes (signalé avec captures)

| Problème | Cause | Correction | Vérification |
|---|---|---|---|
| Chaque réponse du chat affichée et enregistrée **deux fois** | `stream_message()` (emergentintegrations 0.2.0) termine par un événement `StreamDone` dont `content` = la réponse complète ; `/chat/stream` l'ajoutait aux morceaux déjà reçus (NeuraCo et le prof de langue le géraient déjà) | `StreamDone` ignoré ; anciens messages doublés affichés une seule fois et envoyés une seule fois à l'IA | Boucle réelle extraite de `server.py` : avant correctif 198 caractères pour 99 (bug reproduit), après 99 |
| Toujours la même phrase « Je vous rappelle qu'il est important de rester respectueux… » | Règle 5 du prompt de base (« avertis poliment une fois, puis refuse ») en contradiction avec la règle de rappel islamique ; l'historique doublé renforçait la répétition | Règle 5 renvoie à la règle de rappel ; réponse générique interdite ; liste de références sûres (Coran 17:53, 49:11, 50:18, 41:34, 24:30-31 ; hadiths de Bukhari, Muslim, Tirmidhi) pour un rappel lié au propos et varié | Contrôles du prompt OK ; **le comportement de l'IA doit être vérifié en réel après déploiement** (pas de clé IA ici) |


### 3e passe (local, rien de poussé ni déployé) — 14/10/2026

| Sujet | Problème | Correction | Vérification |
|---|---|---|---|
| Modèles IA (backend local `neura-alnour-repo`, commit `dfca953`) | 3 modèles des routeurs retirés (404) : `claude-3-5-haiku-20241022`, `gemini-2.0-flash(-lite)` → niveaux du chat en panne ; 22 modèles récents refusent `temperature` ; Gemini 2.5 Pro répond vide sous 4 096 tokens | Modèles retirés remplacés ; température non envoyée à ces 22 modèles ; budget ≥ 4 096 pour les modèles à raisonnement ; **catalogue de 45 modèles** pour Plus, Neura+, Ultra et VIP (Gratuit/Mongo inchangés) ; menu groupé par fournisseur | 62 modèles testés réellement ; 20/20 contrôles dont 9 appels réels via le routage de l'app |
| Offre Développeur (19,99 €) | — | Retirée de la page et de `/subscriptions/plans`, refusée au paiement ; abonnés existants et VIP inchangés | Tests front + test backend mis à jour |
| Offres affichées à un abonné | Un abonné Ultra/Neura+/Plus pouvait « Souscrire » à une offre inférieure (2e abonnement) | Offres inférieures affichées « Inclus avec … » | Tests de rendu (Ultra, Plus) |
| Moushaf | En double page, « suivante » n'avançait que d'une page (page répétée) | Pas de 2 pages en vue double (≥ 768 px), compteur « 1–2 / 604 » | Navigateur : 1–2 → 3–4 → 1–2, pages 3 et 4 affichées |
| Ramadan | Horaires présentés comme Ramadan toute l'année ; cartes vides si le serveur échoue ; position non mémorisée | Date hégirienne (Umm al-Qura, identique à Aladhan) et avis hors Ramadan ; erreur + « Réessayer » ; même position que les rappels de prière | Tests (14/10/2026 hors Ramadan, 15/02/2027 en Ramadan) + navigateur |
| Coran (lien direct) | — | Déjà corrigé en 1re passe (écran chargement/erreur) | — |

Hors périmètre (à la demande) : **NeuraCo** n'est pas modifié (son catalogue contient aussi des modèles retirés).
Clé IA : temporairement dans `neura-alnour-repo/backend/.env` (ignoré par Git) ; une clé « Neura Al Noor API » la remplacera à la fin.
Résultats : frontend **69/69 tests**, build OK ; backend 20/20 + 12/12 + 8/8.


### 4e passe — chasse aux bugs (local) — 14/10/2026

Méthode : deux relectures indépendantes (frontend, backend Neura Al Noor hors NeuraCo) avec consigne de ne remonter que des défauts démontrables ; **chaque point vérifié dans le code avant correction**.

**Frontend (70/70 tests)**
- Chat : changer de conversation (ou « Nouvelle Discussion ») pendant une réponse affichait la réponse de A dans B et mélangeait les conversations → garde-fou par vue + réponse ignorée à l'écran (le serveur l'enregistre). Test de non-régression (échoue sans le correctif).
- Chat : état développeur et pièces jointes conservés d'une conversation à l'autre → remis à zéro.
- Chat : images générées et réponses du mode Développeur effacées au message suivant (le serveur ne les enregistre pas dans la conversation) → conservées pendant la visite.
- Chat : « Créer une image » en mode Work envoyait le texte au mode Work ; bouton Envoyer actif mais sans effet pendant une réponse ; image générée plus large que la bulle sur mobile ; erreur 422 (liste) passée au toast.
- Développeur : même mélange de sessions pendant une requête ; « Régén. dans » vide.
- Espace Projet inutilisable sur téléphone → disposition verticale.
- Islam Learning : choisir un thème pendant une réponse ne lançait jamais sa leçon → message d'attente.
- Paramètres : identifiant brut de l'offre (« NEURA_PLUS ») → nom lisible ; « Retour » quittait l'app si ouverte directement.
- Accueil : grille des offres à 4 colonnes pour 3 offres. Multijoueur : catégorie/difficulté en clés brutes, message « Recherche de joueurs… » pour toutes les actions. Missions : toast d'échec après une validation réussie.

**Backend (commit local `4740384`, 18/18 + 40 contrôles existants)**
- Après une réinitialisation de mot de passe, **toutes les requêtes du compte renvoyaient 500** (dates MongoDB sans fuseau) ; même cause : la double authentification ne pouvait jamais être activée.
- **E-mails** : compte créé avec des majuscules → réinitialisation impossible, connexion sensible à la casse, **doublon de compte via Google** → recherches insensibles à la casse.
- **L'IA ne voyait que les plus anciens messages** des longues conversations (chat, Work, Développeur, prof de langue, Islam Learning) → derniers messages.
- Raccourci « date du jour » : enregistrement possible dans la conversation d'un autre utilisateur (vérification après coup) → vérification avant.
- **Neura Ultra limité à 3 images** à vie → quota Neura+ (Ultra inclut Neura+).
- `/learn/progress` : erreur 500 dès le 2e enregistrement. Recherche : « ( » ou « c++ » → 500.

Constaté mais non corrigé : reprise d'une requête échouée avec le même identifiant (l'app en génère toujours un nouveau, non déclenchable).

### 5e passe — points en attente réglés (commit local `3a18c29`)

| Problème | Correctif | Preuve |
|---|---|---|
| Abonnements offerts (panel fondateur) **sans expiration** : `gifted_until` n'était lu que pour NeuraCo | Le cadeau donne l'offre jusqu'à `gifted_until`, même si un ancien paiement Stripe est annulé ; à l'expiration, retour au gratuit sauf si une période payée est en cours. `/auth/me` renvoie `gifted_until`. | 6 contrôles (cadeau actif, expiré, Stripe annulé, période payée en cours, abonnés payants inchangés) |
| **Connexion Google sans code 2FA** (la connexion par mot de passe le demandait) ; l'app web n'avait d'ailleurs **aucun écran pour saisir le code**, même par mot de passe | Serveur : pour un compte 2FA, `/auth/google/session` ne délivre plus de jeton mais un défi de 5 min, finalisé par `POST /auth/google/2fa` (5 essais, usage unique, index TTL). App : champ « Code de double authentification » sur la page de connexion et sur le retour Google. | 8 contrôles serveur + 5 tests Jest |
| **Quota Développeur gratuit** contournable en envoyant plusieurs requêtes en même temps (vérification avant l'appel IA, décompte après) | Décompte atomique **avant** l'appel IA (`$inc` conditionnel), remboursé si l'IA échoue ou si le garde-fou Neura+ refuse. | 10 requêtes simultanées, limite 5 → exactement 5 acceptées ; remboursement, fenêtre, anciens documents, VIP |
| Ancienne route `/quiz/answer` (non utilisée par l'app) : **chaque réponse comptait comme un quiz terminé** → missions farmables | La route enregistre toujours l'historique mais n'alimente plus les missions (les sessions de quiz le font, une fois par réponse). | contrôle de code |
| **Revanche multijoueur** dans la même salle : scores, bonnes réponses, séries et badges de la partie précédente conservés (et ré-enregistrés dans l'historique) | Remise à zéro de toutes les statistiques de partie de chaque joueur dans la même mise à jour atomique qui démarre la partie (`players.$[]`). | contrôle de code (la base simulée ne gère pas `$[]`, supporté par MongoDB ≥ 3.6 / Atlas) |

Résultats : frontend **75/75** tests, build OK ; backend 25/25 nouveaux contrôles + 18/18, 8/8, 12/12 existants ; `backend-fixes-production.patch` contient les 5 commits (aucune clé dedans).

Note : le serveur est partagé avec NeuraCo (non modifié). Un client NeuraCo qui utiliserait la connexion Google sur un compte avec 2FA recevra désormais « Code de double authentification requis » au lieu d'un accès sans code.

### 6e passe : langues, voix, appels (commits locaux `0751328` à `580c516`)

| Demande | Réalisation |
|---|---|
| Catégorie **Langues** à la place de la carte NeuraCo de l'accueil | Carte « Langues » vers `/language-tutor` |
| **Apprendre toutes les langues** et une IA qui répond dans toutes les langues (chat et professeur) | 124 langues, dont la darija, le tarifit, le kabyle, l'anglais et l'espagnol. Réponse dans la langue du dernier message |
| **Une conversation enregistrée par langue** | Sessions par langue : reprendre, nouvelle conversation, supprimer |
| **Comptes VIP** | Vérifiés : intacts |
| **Choix de la voix** (féminine ou masculine) et **appel vocal** dans le chat et chez le professeur | 9 voix, bouton d'appel à côté de « Envoyer » et dans le menu « + ». Pas d'envoi tout seul pendant que l'utilisateur tape. Accent natif de chaque langue. Voix lue phrase par phrase (≈ 3 à 4 s au lieu de 8 à 12 s) |

### 7e passe : Neura Gateway et moteur d'IA interchangeable (commit local `6f5b3b1`)

| Élément | Réalisation |
|---|---|
| **Ta propre API** | Clés `nan_…` (affichées une seule fois, stockées en empreinte HMAC), révocation, quotas par clé (requêtes par minute, Neurons par jour, requêtes simultanées), anti-force brute, `/v1/chat/completions` compatible OpenAI (avec ou sans streaming), `/v1/models`, `/v1/usage` |
| **Administration** | Onglet **API & IA** du panneau fondateur : moteur actif, Neurons du jour, cache, temps de réponse, file d'attente, clés |
| **Moteur séparé du fournisseur** | Cloudflare Workers AI aujourd'hui (`NEURA_INFERENCE_PROVIDER=cloudflare`), ton propre serveur demain (`openai_compatible`) sans toucher à l'app |
| **0 € garanti** | Budget réservé **avant** chaque appel et arrêt à 9 000 Neurons par jour (Cloudflare gratuit : 10 000, et il refuse au-delà sans facturer). Mode strict `NEURA_LEGACY_AI=off` : plus aucun appel à un fournisseur payant |
| **Économie de Neurons** | Les 10 derniers messages, plus un résumé des plus anciens (au lieu de 50 à 200 messages), et un cache pour les premières questions identiques |
| **Par défaut, rien ne change** | `NEURA_INFERENCE_PROVIDER=emergent` : l'app fonctionne exactement comme avant |

**Tests :**
- backend : 28 nouveaux tests, plus 110 tests existants identiques avant et après (les 45 échecs déjà présents viennent de tests qui ont besoin d'un serveur en ligne) ;
- frontend : 125/125, build OK ;
- essai de bout en bout sur le vrai `server.py` avec un moteur simulé : 300 requêtes simultanées toutes servies grâce à la file d'attente.

Détails, calculs et procédure de mise en route : `DEPLOIEMENT_CLOUDFLARE.md` dans le dépôt backend.

## F. Éléments restant à fournir

1. **Déployer `fix/production-chat-moderation-coran`** sur Render (même procédure que pour la branche billing actuelle), puis vérifier `/api/quran/surah/1` et refaire le test des insultes.
2. **Redéployer le frontend sur Vercel** à partir de cette archive (le dossier `frontend/` du dépôt GitHub est une version plus ancienne et n'a pas été modifié).
3. **Compte de test** : je ne peux ni créer de compte ni me connecter à la production. À tester par toi : chat IA, Work, images, Développeur, multijoueur, paiement Stripe en mode test.
4. Le `.env` livré pointe sur `http://localhost:8000` ; en production, `REACT_APP_BACKEND_URL` reste défini dans Vercel.

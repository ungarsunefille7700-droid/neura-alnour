# Neura Al Noor : état avant publication (15/10/2026)

Tout a été fait en local : rien n'a été déployé et aucune donnée de production n'a été touchée.

**Points de restauration :**
- tag git `sauvegarde-20261015-1330` ;
- dossier `D:\neura-alnour-complete\sauvegardes\` : archive du site et base de test locale.

## 1. Ce qui a été réellement testé, et le résultat

### Création d'un projet dans l'application (navigateur, compte de test local)

| Étape | Résultat observé |
|---|---|
| Nouvelle discussion, demande « jeu de quiz islamique en HTML, CSS et JavaScript » | ✅ |
| « NEURA AL-NOUR · Réflexion en cours » apparaît | ✅ en moins d'1 s |
| Étapes affichées (« Analyse de ta demande », « Écriture de index.html · 48 lignes ») | ✅ |
| Code source visible dans le chat | ✅ aucun bloc de code, pendant toute la génération |
| Fin du travail | ✅ « Réfléchi pendant 46 s » |
| Carte projet avec « Ouvrir » et « Télécharger (.zip) » | ✅ |
| Clic réel sur « Ouvrir » | ⚠️ L'application appelle bien l'ouverture d'un onglet avec l'adresse du jeu. Mais **le navigateur de test bloque toute nouvelle fenêtre**, même une page vide : ce n'est pas un défaut de l'application. Le contenu ouvert par ce bouton a donc été testé autrement (ligne suivante) |
| Page exacte produite par « Ouvrir » (même fonction que l'application), jouée | ✅ CSS et JavaScript intégrés, partie complète, aucune erreur |
| Clic réel sur « Télécharger (.zip) » | ✅ Fichier `neura-projet-20261015-1404.zip` de 5 618 octets, signature ZIP valide |
| ZIP téléchargé, décompressé par Windows | ✅ 4 fichiers (index.html, style.css, script.js, README.md), JavaScript valide (`node --check`) |
| Jeu décompressé, ouvert hors de Neura Al Noor et joué | ✅ Bonnes et mauvaises réponses en alternance, score juste à chaque question, écran de résultat « 3 sur 5 », « Rejouer » fonctionne, aucune erreur JavaScript |
| Rechargement de la conversation | ✅ La carte et « Réfléchi pendant… » restent affichés |

### Vérification du reste de l'application

- **22 pages ouvertes dans le navigateur, sans aucune erreur :** accueil, connexion, chat, Développeur, Langues, Panneau fondateur, Réglages, Abonnements, Prières, Coran, Moushaf, Qibla, Douas, Quiz, Quiz multijoueur, Apprendre, Académie, Mosquées, Ramadan, Missions, Rappels, Soutien.
- **Mobile (375 px de large) :** aucune page ne déborde sur le côté. Une carte projet était mal affichée sur mobile : c'est corrigé (voir §2).
- **17 vérifications réelles sur un compte gratuit tout neuf**, toutes réussies :
  - inscription ;
  - connexion, et refus d'un mauvais mot de passe ;
  - accès refusé sans connexion ;
  - mémoire : ajout, refus d'un mot de passe, lecture, suppression ;
  - chat en streaming qui **utilise la mémoire** (« Tu habites à Lyon. » en 0,6 s) ;
  - historique des conversations relu ;
  - 9 voix et synthèse vocale ;
  - quota ;
  - clés API refusées à un compte non-admin.

### Tests automatisés

| Suite | Résultat |
|---|---|
| Site (frontend) | **154/154** réussis, version de production compilée sans erreur |
| Serveur (tests unitaires et moteur d'IA) | **143 réussis**, dont 35 sur le moteur d'IA et la Gateway |
| Serveur : 45 tests qui appelaient une ancienne adresse Emergent hors service | relancés **contre le serveur local** : 47 réussis |
| Serveur : 7 tests qui restent en échec | **Ce ne sont pas des bugs** : 3 utilisent l'identifiant et le mot de passe d'un compte VIP qui n'existait que sur l'ancien serveur ; 4 testent le paiement Stripe sans clé Stripe configurée en local |

## 2. Bugs réellement constatés et corrigés

| # | Fonctionnalité | Constaté (preuve) | Cause | Correction | Vérifié après |
|---|---|---|---|---|---|
| 1 | Projets de code générés | Quiz bloqué dès le départ. Console : `Uncaught TypeError: Cannot set properties of null (setting 'innerHTML') at showQuestion (script.js:127)` | Le HTML avait `class="options-grid"`, alors que le JavaScript cherchait `getElementById('options-grid')` | Consigne de cohérence entre fichiers donnée à l'IA, plus une **vérification automatique** dans l'app (id manquants, fichiers manquants, erreurs de syntaxe JavaScript) avec un bouton « Corriger automatiquement » | La vérification signale ce projet et aucun des projets corrects (pas de faux positif) ; 8 tests |
| 2 | Modèle de code | GLM 4.7 Flash : 3 projets cassés sur 8 (id manquant, HTML corrompu `<option name="viewport">`, erreur de syntaxe), confirmés par `node --check` | Fiabilité du modèle sur les longues réponses. L'hypothèse d'un réglage de créativité trop élevé a été **testée et écartée** | Changement de modèle, d'après les mesures : **GPT-OSS 120B** pour les abonnés et VIP (5/5), **Gemma 4** pour les comptes gratuits (5/5, compatible avec leur quota) | Jeux générés joués : score, résultat et « Rejouer » corrects |
| 3 | Quiz IA | Journal : `AI quiz generation timed out, using the built-in questions` (×14). Le test « catégorie Coran » obtenait 4 questions au lieu de 10 | **Régression que j'avais introduite** : le mot « JSON » du prompt du quiz le faisait prendre pour une demande de code (modèle lent), avec une réponse limitée à 700 tokens et un délai d'attente de 15 s | Les générations internes de l'app ne sont plus traitées comme du code et gardent la longueur demandée. Délai porté à 35 s quand Cloudflare est actif (≈ 21 s mesurées) | 10 questions IA en 17,8 s ; tests du quiz contre le serveur local : 14 réussis, 0 échec |
| 4 | Budget gratuit | Compteur du jour à 7 939 unités, alors que les requêtes réelles n'en totalisaient que ≈ 1 697. Un compte gratuit tout neuf recevait « quota épuisé » | Une requête abandonnée (délai dépassé, client parti) ne rendait pas sa réservation | La réservation est rendue quel que soit le motif d'arrêt | Test qui reproduit le bug (19,1 unités bloquées avant, 0 après) ; compte gratuit fonctionnel |
| 5 | Carte projet sur mobile | Nom du projet réduit à une seule lettre (« Q ») sur un écran de 375 px | Les boutons prenaient toute la largeur | Sur téléphone, les boutons passent sur une 2e ligne. Sur ordinateur, rien ne change | Mesuré : nom entier sur mobile, une seule ligne sur ordinateur |
| 6 | Réflexion affichée | Le raisonnement de GPT-OSS s'affichait en anglais | Ce modèle raisonne toujours en anglais, même quand on le lui demande en français (testé) | Le raisonnement en anglais n'est plus affiché ; les étapes restent en français | Test automatique |

**Fausses pistes vérifiées, qui ne sont pas des bugs :**
- le bouton « Ouvrir » qui n'ouvre rien (blocage propre au navigateur de test) ;
- la page `/gamification` vide (cette page n'existe pas, c'est `/rewards`, qui fonctionne) ;
- les erreurs « Mosquées » dans le journal : le service externe Overpass répondait 502/504, et la page gère le cas.

## 3. Ce qui bloque encore la publication

| Priorité | Problème | Pourquoi ça bloque | Ce qu'il faut décider ou faire |
|---|---|---|---|
| **P1** | **Pages légales absentes** : mentions légales, politique de confidentialité, conditions d'utilisation et de vente. Constaté : aucune page ni aucun texte dans le site | Obligatoires en France et dans l'UE (LCEN, RGPD) pour un site avec comptes, données personnelles et abonnements payants | Je peux rédiger les pages. Il me faut tes informations d'éditeur (nom ou raison sociale, adresse, e-mail de contact, éventuel SIRET). Un relecteur juridique reste conseillé : je ne suis pas avocat |
| **P1** | **Promesses d'abonnement** : le plan Plus (22 €/mois) annonce « GPT-6, Claude Opus 5.5, Gemini 3.8 au choix ». Avec le moteur gratuit Cloudflare, ce sont Gemma 4 et GPT-OSS qui répondent | Vendre ce qui n'est pas fourni (pratique commerciale trompeuse) | **Option A** : réécrire les offres pour coller au moteur gratuit (rien à payer). **Option B** : garder l'ancien fournisseur payant pour les abonnés, ce qui contredit le 0 € |
| **P1** | **Menu « Modèle »** : il affiche « GPT-4o — OpenAI » alors que c'est Gemma ou GPT-OSS qui répond | Information fausse donnée à l'utilisateur | À aligner avec la décision précédente |
| **P1** | **Hébergement du site** : Vercel Hobby est réservé à un usage *« non-commercial, personal use only »* (doc officielle). Or l'app vend des abonnements | Non-respect des conditions de Vercel | Cloudflare Pages (gratuit, sans carte) |
| **P1** | **Vidéos de rappel** : 4 fichiers de 45 à 96 Mo, alors que Cloudflare Pages accepte au maximum 25 Mo par fichier | Le site ne pourrait pas être publié sur Cloudflare Pages tel quel | Compresser les vidéos sous 25 Mo, **ou** les héberger sur YouTube en non répertorié et les intégrer (gratuit) |
| P2 | Serveur Render gratuit : mise en veille après 15 min, ≈ 1 min de réveil | La première visite après une pause est lente | Acceptable au lancement ; sinon, un service qui « réveille » le serveur |
| P2 | Le site affiche `REACT_APP_BACKEND_URL=http://localhost:8000` dans `.env` | Valeur locale | À définir sur l'hébergeur au moment du déploiement (pas dans le code) |
| P2 | Capacité gratuite : ≈ 250 messages de chat par jour pour toute l'app (≈ 40 projets de code) | Suffisant pour démarrer, pas pour 1 000 utilisateurs actifs | Déjà documenté (`DEPLOIEMENT_CLOUDFLARE.md`) |

## 4. Feuille de route jusqu'à la publication

1. **Toi :** choisir l'option A ou B pour les abonnements, et me donner les informations d'éditeur pour les pages légales.
2. **Moi :**
   - pages légales et liens dans le pied de page et à l'inscription ;
   - mise en accord des offres et du menu « Modèle » avec ta décision ;
   - vidéos (compression ou YouTube, selon ton choix).
3. **Moi :** préparer le déploiement :
   - Cloudflare Pages pour le site ;
   - Render pour le serveur ;
   - MongoDB Atlas M0 pour la base ;
   - liste exacte des variables, toutes à saisir par toi dans les tableaux de bord.
4. **Ensemble :** déploiement sur ton autorisation explicite, puis la même batterie de tests sur la vraie adresse HTTPS.

**Après le lancement (facultatif) :**
- voix entièrement gratuite (aujourd'hui l'ancien fournisseur) ;
- analyse d'images avec Gemma 4 ;
- noms réels des modèles dans le menu.

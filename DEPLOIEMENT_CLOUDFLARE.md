# Neura Al Noor : Neura Gateway et Cloudflare Workers AI (0 €, sans carte)

*Document rédigé le 14 octobre 2026. Les conditions de Cloudflare ont été lues ce jour-là sur les pages officielles.*

---

## 1. Ce que Cloudflare garantit (vérifié le 14/10/2026)

| Question | Réponse | Source |
|---|---|---|
| Inscription sans carte ? | Oui pour le plan **Workers Free** : Cloudflare dit qu'on peut commencer « without adding a credit card ». C'est une phrase marketing, à confirmer au moment de l'inscription. **Les programmes Étudiants et Startups, eux, demandent une carte : ne pas s'y inscrire.** | cloudflare.com/students, cloudflare.com/hatch |
| 10 000 Neurons gratuits par jour ? | Oui : *« 10,000 Neurons per day at no charge »*, avec une **remise à zéro à 00:00 UTC** | developers.cloudflare.com/workers-ai/platform/pricing |
| Quand le quota est épuisé ? | *« further operations will fail with an error »* : les requêtes sont **refusées, pas facturées**. Le plan Free n'a aucune option payante (« N/A – Upgrade to Workers Paid ») | idem |
| Limite de requêtes | Génération de texte : **300 requêtes par minute**. Reconnaissance vocale : 720 par minute | developers.cloudflare.com/workers-ai/platform/limits |
| Modèles réservés aux comptes payants | Kimi K2.6/K2.7, GLM-5.2/5.3/5.3-flash, DeepSeek V4. **Ils ne sont jamais utilisés par Neura** | pricing |
| Frais au-delà de 10 000 Neurons | 0,011 $ par tranche de 1 000 Neurons, **uniquement avec Workers Paid (5 $/mois, carte obligatoire)**. Sans carte, impossible d'y passer | pricing |

**Notre double sécurité :**
1. La Neura Gateway arrête tout à **9 000 Neurons par jour**, avant la limite de Cloudflare. Ce chiffre se règle avec `NEURA_AI_DAILY_NEURONS`.
2. Si notre compteur se trompait, Cloudflare refuserait lui-même les demandes à 10 000 Neurons, sans facturer.

## 2. Les autres services : 0 € ?

| Service | Situation | À faire |
|---|---|---|
| **Render** (backend) | Plan Free : *sans moyen de paiement, Render suspend les services au lieu de facturer* (doc officielle). 750 h par mois, mise en veille après 15 min d'inactivité | **Vérifie qu'aucune carte n'est enregistrée sur ton compte Render** |
| **MongoDB Atlas M0** (base de données) | Gratuit : 512 Mo, 100 opérations/s, 500 connexions (doc officielle). Je n'ai pas vérifié aujourd'hui qu'aucune carte n'est demandée | Ne jamais passer à « Flex » ou « M10 » |
| **Vercel Hobby** (site) | Gratuit, mais **réservé à un usage personnel et non commercial** (doc officielle). Or l'app vend des abonnements | Plus tard : déménager le site sur **Cloudflare Pages** (gratuit, sans carte). Je n'ai rien changé |
| **Emergent** (ancienne clé IA) | Toujours utilisé tant que `NEURA_LEGACY_AI=on` (images, outils, voix hors français/anglais) | Mettre `NEURA_LEGACY_AI=off` pour le mode 100 % gratuit (voir §5) |
| Stripe, Resend, Tavily | Inchangés. Leurs conditions gratuites n'ont pas été revérifiées aujourd'hui | Vérifie qu'aucun plan payant n'est actif |

## 3. Architecture

```
App Neura Al Noor ─┐
                   ├─► Neura Gateway ──► NeuraRuntime ──► InferenceProvider
Clés nan_ (API) ───┘   (clés, auth,      (budget en Neurons,    ├─ Cloudflare Workers AI (aujourd'hui)
   /v1/...              quotas par clé,   file d'attente,        └─ ton propre serveur (plus tard,
                        anti-abus,        cache, historique         vLLM / llama.cpp / Ollama,
                        statistiques)     compacté, journal)        même format OpenAI)
```

| Fichier | Rôle |
|---|---|
| `backend/neura_inference.py` | Les fournisseurs (Cloudflare, ou n'importe quel serveur au format OpenAI) et le tarif officiel en Neurons |
| `backend/neura_budget.py` | Budget en Neurons (réservation atomique **avant** chaque appel), file d'attente, limite de requêtes par minute |
| `backend/neura_engine.py` | Moteur central : compaction de l'historique, cache, journal, statistiques. Remplace `LlmChat` à l'identique |
| `backend/neura_gateway.py` | Ton API : clés `nan_`, authentification, quotas par clé, protection anti-force brute, `/v1/chat/completions`, administration |
| `src/components/admin/ApiKeysPanel.js` | Onglet **« API & IA »** du panneau fondateur |
| `backend/scripts/bench_cloudflare.py` | Banc d'essai : qualité par langue, vitesse, Neurons, test de charge |

**Passer plus tard à ton propre moteur** ne demande que trois variables :
`NEURA_INFERENCE_PROVIDER=openai_compatible`, `NEURA_ENGINE_URL=http://ton-serveur:8000/v1`, `NEURA_ENGINE_MODEL=…`.
Tes clés `nan_`, les quotas et l'app restent identiques.

## 4. Choix du modèle (calculs)

**Mesure faite sur ton app :** le premier message du chat envoie environ 7 000 caractères (prompt système, garde-fous, mémoire), soit **≈ 2 000 tokens**. En milieu de conversation, avec les 10 derniers messages et le résumé des plus anciens, cela monte à **≈ 3 500 tokens**. Une réponse fait en moyenne ≈ 350 tokens (700 au maximum).

| Modèle (Cloudflare) | Neurons par million de tokens (entrée / sortie) | 1er message | En conversation | **Messages par jour avec 9 000 Neurons** | Remarques |
|---|---|---|---|---|---|
| **@cf/google/gemma-4-26b-a4b-it** (par défaut) | 9 091 / 27 273 | 27,7 | 41,3 | **≈ 250** | MoE (rapide), contexte de 256 000 tokens, vision. Le « thinking » est désactivé pour ne pas payer de tokens cachés |
| @cf/qwen/qwen3-30b-a3b-fp8 | 4 625 / 30 475 | 19,9 | 26,9 | **≈ 390** | Le plus économe des bons modèles. Contexte de 32 000 tokens |
| @cf/zai-org/glm-4.7-flash | 5 500 / 36 400 | 23,7 | 32,0 | ≈ 320 | Contexte de 131 000 tokens. Modèle de raisonnement |
| @cf/meta/llama-3.1-8b-instruct-fp8 | 13 778 / 26 128 | 36,7 | 57,3 | ≈ 190 | Plus faible en arabe et en darija |
| @cf/openai/gpt-oss-20b | 18 182 / 27 273 | 45,9 | 73,1 | ≈ 150 | Raisonne toujours : plus de tokens en sortie |
| @cf/mistralai/mistral-small-3.1-24b-instruct | 31 876 / 50 488 | 81,4 | — | ≈ 100 | Très bon en français, mais coûteux |

Calcul : (tokens d'entrée × tarif d'entrée + tokens de sortie × tarif de sortie) ÷ 1 000 000. Par exemple, pour Gemma au 1er message : 2 000 × 9 091 ÷ 10⁶ + 350 × 27 273 ÷ 10⁶ = 18,2 + 9,5 = 27,7 Neurons.

**Recommandation :** Gemma 4 26B par défaut, ou Qwen3 30B si tu veux plus de messages par jour. **La qualité en darija et en tarifit n'est publiée nulle part** : lance `bench_cloudflare.py` (§6) et lis les réponses avant de décider.

**Réduire la consommation sans perdre la mémoire (déjà fait) :**
- seuls les **10 derniers messages** sont envoyés en entier ;
- les plus anciens sont remplacés par un **résumé de 12 lignes** (au lieu des 50 à 200 messages envoyés avant) ;
- une **limite de 6 000 tokens** en entrée s'applique ;
- une **réponse limitée à 700 tokens** ;
- le **cache** des premières questions identiques est gratuit (7 jours) ;
- la mémoire de l'utilisateur (`/ai/memory`) reste dans le prompt système, donc elle est toujours prise en compte.

## 5. Ce qui marche gratuitement, et ce qui ne marche pas

| Fonction | Gratuit avec Cloudflare ? | Détail |
|---|---|---|
| Chat, conversations, historique | ✅ | Passe par le moteur. L'historique est enregistré comme avant |
| Mémoire utilisateur | ✅ | Inchangée (MongoDB) |
| Professeur de langues, quiz, apprentissage islam | ✅ | Même moteur |
| Français, anglais, arabe | ✅ (en principe) | Modèles multilingues. **À confirmer avec le banc d'essai** |
| Darija | ⚠️ | Aucun modèle Cloudflare n'a été évalué en darija. Banc d'essai obligatoire |
| Tarifit | ❌ en pratique | Aucun modèle ne le maîtrise, et Whisper ne le reconnaît pas. Déjà faible avec Gemini |
| Transcription de la voix (STT) | ✅ `NEURA_VOICE_STT_PROVIDER=engine` | Whisper large-v3-turbo, ≈ 3,9 Neurons pour 5 s d'audio |
| Voix de l'IA (TTS) | ⚠️ français et anglais seulement | MeloTTS, **une seule voix**, ≈ 4,4 Neurons pour 200 caractères. Le choix parmi tes 9 voix, l'arabe, la darija et le tarifit ne sont **pas possibles gratuitement** : ils restent sur l'ancien fournisseur si `NEURA_LEGACY_AI=on` |
| Appel vocal | ⚠️ | Un tour d'appel ≈ 43 Neurons (STT + IA + voix), soit ≈ 200 tours par jour pour toute l'app |
| Analyse d'image, outils | ❌ (pour l'instant) | Restent sur l'ancien fournisseur. Refusés si `NEURA_LEGACY_AI=off`. Gemma 4 accepte les images : à ajouter plus tard |
| Génération d'images | ❌ | OpenRouter, payant. Refusée si `NEURA_LEGACY_AI=off` |
| Comptes, abonnements, VIP, interface | ✅ | Inchangés |

`NEURA_LEGACY_AI=on` (par défaut) préserve ce qui marche déjà avec l'ancien fournisseur.
`NEURA_LEGACY_AI=off` correspond au **0 € strict** : ce que le moteur gratuit ne sait pas faire est refusé avec un message clair.

## 6. Capacité réelle : ce que 0 € permet (calculs)

Avec **9 000 Neurons par jour ≈ 250 messages par jour pour toute l'app** (Gemma), ou ≈ 390 avec Qwen3 :

| Situation | Besoin | Gratuit ? |
|---|---|---|
| 100 inscrits (≈ 30 actifs par jour, 8 messages chacun) | ≈ 240 messages par jour | ✅ tout juste |
| 1 000 inscrits (≈ 300 actifs par jour, 15 messages chacun) | ≈ 4 500 messages par jour | ❌ **18 fois trop** : il faudrait se limiter à environ 1 message par jour et par personne active |
| 300 personnes qui discutent en même temps (1 message toutes les 45 s) | 6,7 messages par seconde, soit ≈ 400 par minute | ❌ Le budget du jour serait épuisé en **≈ 40 secondes**, et la limite de Cloudflare (300 requêtes par minute) dépassée |

**L'infrastructure, elle, tient la charge** (mesuré en local avec un moteur simulé, 1 s par réponse, 20 en parallèle) :
- **300 requêtes simultanées : 300 servies sur 300**, médiane 8,2 s, maximum 15,4 s, grâce à la file d'attente ;
- avec une petite file (5 en parallèle, 10 en attente), 40 requêtes donnent 15 servies et **25 refusées proprement** (503 « saturée, réessaie »), au lieu de faire planter le serveur ;
- le seul vrai frein, c'est **le quota gratuit de Cloudflare**. Quand tu auras ton propre GPU, tu changeras seulement `NEURA_INFERENCE_PROVIDER`.

**Répartition par défaut du quota quotidien :**

| Profil | Limite par jour | Équivalent |
|---|---|---|
| Gratuit | 250 Neurons | ≈ 7 messages |
| Abonné | 900 Neurons | ≈ 25 messages |
| VIP et fondateurs | illimité, dans la limite du total du jour | — |

Les comptes gratuits ne peuvent consommer que **70 %** du budget du jour : les **30 % restants sont réservés** aux abonnés et aux VIP.

## 7. Mise en route (c'est toi qui fais les étapes 1 à 4)

1. **Créer le compte Cloudflare** sur https://dash.cloudflare.com/sign-up. Plan **Free**, **n'ajoute aucune carte**, ne t'inscris ni au programme Étudiants ni au programme Startups.
2. Dans le tableau de bord, va dans **Workers AI**, puis **Use REST API** :
   - **Create a Workers AI API Token**, puis **Create API Token**. Copie le jeton : il n'est affiché qu'une fois.
   - Copie aussi l'**Account ID**.
   - Ne m'envoie jamais ce jeton dans le chat.
3. **Banc d'essai sur ton PC** (≈ 1 500 Neurons au maximum, gratuit). Dans PowerShell :
   ```
   cd D:\neura-alnour-complete\neura-alnour-repo\backend
   $env:CLOUDFLARE_ACCOUNT_ID="ton-account-id"
   $env:CLOUDFLARE_API_TOKEN="ton-jeton"
   python scripts/bench_cloudflare.py --load 10
   ```
   Lis le rapport `scripts/bench_cloudflare_*.md`, en particulier les réponses en darija et en tarifit, puis choisis le modèle.
4. **En local d'abord** : ajoute ces lignes dans `backend/.env` (ce fichier n'est jamais envoyé sur GitHub) :
   ```
   NEURA_INFERENCE_PROVIDER=cloudflare
   CLOUDFLARE_ACCOUNT_ID=…
   CLOUDFLARE_API_TOKEN=…
   NEURA_ENGINE_MODEL=@cf/google/gemma-4-26b-a4b-it
   NEURA_LEGACY_AI=on
   ```
   Redémarre le backend, teste l'app, puis ouvre **Panel Fondateur → API & IA**.
5. **Mise en ligne** (seulement quand tu me le demandes) : mêmes variables dans Render, onglet *Environment*. C'est toi qui les saisis.
6. **Mode 0 € strict**, quand tout te convient : `NEURA_LEGACY_AI=off`, `NEURA_VOICE_STT_PROVIDER=engine`, `NEURA_VOICE_TTS_PROVIDER=engine`.

**Retour en arrière immédiat :** `NEURA_INFERENCE_PROVIDER=emergent`. L'app redevient exactement comme avant.

## 8. Utiliser ta propre API

1. **Panel Fondateur → API & IA → Nouvelle clé.** La clé `nan_…` s'affiche **une seule fois**. Seule son empreinte HMAC-SHA256 est stockée.
2. Elle s'utilise avec n'importe quel client OpenAI :
   ```
   curl https://<ton-backend>/v1/chat/completions \
     -H "Authorization: Bearer nan_…" -H "Content-Type: application/json" \
     -d '{"model":"neura-al-noor","messages":[{"role":"user","content":"Salam"}]}'
   ```
   Autres routes : `GET /v1/models`, `GET /v1/usage`, et le streaming avec `"stream": true`.
3. **Protections :**
   - chaque clé a ses propres limites : requêtes par minute, Neurons par jour, requêtes simultanées, longueur maximale de réponse ;
   - une adresse est bloquée après 20 clés invalides en 10 minutes ;
   - les messages sont limités à 40 000 caractères et 100 messages par requête ;
   - la révocation est immédiate ;
   - toutes les consommations sont journalisées 30 jours (collection `ai_usage_log`).

## 9. Tests

- `backend/tests/test_neura_gateway.py` (23 tests) :
  - fournisseur Cloudflare (requête, tarif, streaming, erreurs) et serveur auto-hébergé ;
  - compaction de l'historique ;
  - budget (refus avant dépassement, part réservée aux comptes gratuits, remise à zéro UTC) ;
  - file d'attente et saturation ;
  - cache ;
  - remplacement de `LlmChat` ;
  - clés `nan_` (création, stockage haché, révocation, force brute, quotas, format OpenAI avec et sans streaming) ;
  - statistiques.
- `backend/tests/test_neura_server_wiring.py` (5 tests) : branchement dans `server.py` et mode strict.
- `src/components/admin/ApiKeysPanel.test.js` (3 tests) : interface d'administration.
- Les tests existants donnent un résultat identique avant et après l'intégration. Les 45 échecs déjà présents viennent de tests qui ont besoin d'un serveur en ligne.

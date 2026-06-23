# NEURA AL-NOUR (نور) - Product Requirements Document

## Original Problem Statement
Build a full-stack AI chatbot application named "NEURA AL-NOUR (نور)" featuring a general-purpose conversational AI (GPT-5.2) integrated with a comprehensive, 100% free Islamic module.

## Core Requirements
- **AI Core:** GPT-5.2 chat, GPT-4o image analysis, GPT Image 1 generation
- **Islamic Module (Free):** Quran, Duas, Prayer Times, Quiz, Ramadan/Eid, Qiblah, Mosques, Learning
- **Premium:** Stripe subscriptions (4 tiers)
- **Auth:** Email/Password (JWT) + Emergent Google Auth
- **VIP Admins:** kaddanwalidpro@gmail.com, zeroxigamer0@gmail.com

## Tech Stack
- Backend: FastAPI + MongoDB + emergentintegrations
- Frontend: React + Tailwind CSS + shadcn/ui
- External APIs: Aladhan (prayer times/qiblah), Overpass/OSM (mosques), AlQuran Cloud, EveryAyah (audio)

## What's Implemented
- [x] User auth (email + Google OAuth)
- [x] VIP admin recognition
- [x] AI Chat (GPT-5.2 text, GPT-4o vision)
- [x] Image generation (GPT Image 1 in chat, 3 free then Mongo+ required for unlimited, VIP unlimited)
- [x] Quran (114 surahs, Arabic + French, audio from EveryAyah, autoplay)
- [x] Prayer Times (geolocation, Aladhan API - HTTPS fixed)
- [x] Qiblah compass (geolocation + device orientation)
- [x] Nearby Mosques (Overpass/OpenStreetMap API, radius filter, Google Maps itinerary)
- [x] Learn Islam (5 lessons, progress tracking, auth-gated saving)
- [x] Support/Donation (PayPal button -> kaddanaminpro@gmail.com)
- [x] Duas library (8 categories)
- [x] Islamic Quiz (AI-generated 10 questions per session via GPT-5.2, unlimited retries, score tracking, 6 categories)
- [x] Ramadan module (Suhoor/Iftar times, tips)
- [x] Eid module (Al-Fitr & Al-Adha info)
- [x] Stripe subscription checkout (live key, 5 plans, webhook, auto-activation)
- [x] Premium badge (VIP Admin crown badge, plan badge, upgrade link for free users)
- [x] Subscription page with monthly/yearly toggle
- [x] Routes and navigation for ALL features
- [x] Dark/Light theme

## Backlog
### P1 (Next)
- Resend email integration (registration confirmation, password reset) - user deferred
- Premium feature gating enforcement (backend middleware to restrict features by tier)

### P2
- Spiritual coaching (Pro tier)
- Premium themes
- Custom Adhan voices
- Offline Quran download
- Prayer tracking

### P3
- Developer tier API/SDK
- Content moderation system
- Mobile apps (Android/iOS)

## Architecture
```
/app/backend/server.py - All API routes (1600+ lines, needs refactoring)
/app/frontend/src/App.js - Router with all page routes
/app/frontend/src/pages/ - All page components
/app/frontend/src/contexts/ - Auth + Theme contexts
```

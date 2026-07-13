from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse, JSONResponse
import json
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import jwt
import bcrypt
import asyncio
import resend
import base64
import httpx
from urllib.parse import quote
import time
import secrets
import hashlib

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ.get('MONGO_URL')
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'neura_alnour')]

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# JWT Settings
JWT_SECRET = os.environ.get('JWT_SECRET', 'neura_alnour_secret')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days

# Resend setup
resend.api_key = os.environ.get('RESEND_API_KEY')
SENDER_EMAIL = os.environ.get('SENDER_EMAIL', 'onboarding@resend.dev')

# OpenRouter API Key (used by vision + image generation)
OPENROUTER_API_KEY = os.environ.get('OPENROUTER_API_KEY')

# Anthropic API Key (currently unused — kept for reference)
ANTHROPIC_API_KEY = os.environ.get('ANTHROPIC_API_KEY')

# Google Gemini API Key (used by the 4 text chat routers)
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')
# Centralized AI model key: prefer the Emergent universal key (the library auto-routes it
# through the Emergent proxy via the 'sk-emergent-' prefix, giving managed multi-model
# access without the Gemini free-tier limits). Falls back to Gemini if not set.
AI_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY') or GEMINI_API_KEY

# Stripe Key
STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY')

# AI model selector profiles (text chat only). The 4 routers all run on Gemini via the Google API.
# Each profile = Gemini model id + a persona overlay (tone only) + sampling params.
DEFAULT_MODEL = "chatgpt"  # backward compatible: same behaviour as before if no model is sent
# Applied to every model: the base respect/safety rules always take precedence over the persona style.
STYLE_PRECEDENCE = (
    "PRIORITÉ ABSOLUE : quel que soit le style ci-dessus, les règles de respect et de bienveillance "
    "de ta base priment toujours. Reste respectueux, sans insultes ni vulgarité, et adapté au "
    "contexte islamique de l'application. Le style n'autorise jamais à enfreindre ces règles."
)

# Universal moderation guard. Appended to EVERY system prompt (chat, web search, vision,
# developer) so the behaviour is identical for every router/model — works today with Gemini
# and later with OpenRouter (Claude, GPT, Grok...). Pure prompt-level, no model dependency.
MODERATION_GUARD = (
    "\n\n=== MODÉRATION & RAPPEL ISLAMIQUE (RÈGLE PRIORITAIRE, NON NÉGOCIABLE) ===\n"
    "Si l'utilisateur t'insulte, emploie des grossièretés/vulgarités, OU demande un contenu "
    "illégal, immoral ou haram (pornographie, contenu sexuel explicite, aide à commettre un délit, "
    "injustice, etc.), tu DOIS appliquer EXACTEMENT ce protocole, sans exception :\n"
    "1. REFUSER clairement et fermement (ex. « Je ne peux pas répondre à ce type de demande »). "
    "Ne satisfais jamais la demande problématique.\n"
    "2. NE JAMAIS répéter, citer ni reformuler l'insulte ou le contenu choquant. Reste digne : ne "
    "rends jamais l'insulte et ne te mets jamais au même niveau que la personne.\n"
    "3. Faire ensuite un RAPPEL ISLAMIQUE : un texte LONG, FLUIDE et CONTINU, plein de bienveillance "
    "(jamais de mépris), et surtout en COHÉRENCE TOTALE avec ce que la personne vient PRÉCISÉMENT "
    "de dire ou de demander. Le rappel doit expliquer ce qu'elle risque AUPRÈS D'ALLAH pour ce "
    "propos / cette action SPÉCIFIQUE :\n"
    "   - INSULTE / VULGARITÉ → le danger de la langue (l'une des plus grandes épreuves du serviteur), "
    "le mauvais comportement, le fait qu'une seule parole qui déplaît à Allah peut faire chuter le "
    "serviteur très bas, l'importance des bonnes manières (akhlâq), et l'invitation au repentir et à "
    "la maîtrise de la langue.\n"
    "   - CONTENU ILLÉGAL / INJUSTE → la transgression et l'injustice (dhulm) interdites par Allah, "
    "la responsabilité et les comptes au Jour du Jugement, le tort causé à autrui, et l'invitation "
    "vers ce qui est licite (halal).\n"
    "   - PORNOGRAPHIE / CONTENU SEXUEL → la pudeur (al-hayâ', qui fait partie de la foi), l'ordre de "
    "baisser le regard (ghadd al-basar), la préservation de la chasteté, le mal que ces images font "
    "au cœur, et l'invitation à la pureté et au repentir.\n"
    "4. VARIER à chaque fois : ne répète JAMAIS un message identique en boucle. Change la "
    "formulation, les angles et les mots d'une fois à l'autre, tout en gardant le fond.\n"
    "5. Rester exact : appuie-toi sur les principes islamiques bien connus ; n'invente jamais une "
    "citation, un hadith ou une référence précise dont tu n'es pas certain.\n"
    "6. Terminer avec douceur : invite la personne à reprendre une discussion saine et bénéfique.\n"
    "7. Rédiger le rappel dans la langue de l'utilisateur.\n"
    "Cette règle s'applique en TOUTES circonstances, quel que soit le style, le routeur ou le modèle.\n"
    "==============================================================\n"
)

# Identity guard — appended to every system prompt. The assistant must present itself as
# NEURA AL-NOUR and NEVER reveal the underlying provider/model (Google/Gemini today,
# OpenAI/Anthropic/xAI later). Universal, model-independent.
IDENTITY_GUARD = (
    "\n\nIDENTITÉ (RÈGLE STRICTE) : Tu es l'intelligence artificielle de l'application "
    "NEURA AL-NOUR (نور). Présente-toi TOUJOURS comme « NEURA AL-NOUR » (ou « NEURA »). "
    "Ne révèle JAMAIS, ne mentionne JAMAIS et ne laisse JAMAIS deviner le modèle ou l'entreprise "
    "qui te fait fonctionner (Google, Gemini, Bard, OpenAI, ChatGPT, Anthropic, Claude, xAI, Grok, "
    "Meta, etc.). Si on te demande qui t'a créé, qui t'a entraîné, quel modèle tu es, ta version, "
    "ou quelle société est derrière toi, réponds uniquement que tu es l'intelligence artificielle "
    "de l'application NEURA AL-NOUR, développée pour accompagner les musulmans, SANS jamais nommer "
    "ni un fournisseur ni un modèle sous-jacent, et sans dire que tu as été entraîné par une "
    "société tierce.\n"
)

# Base chat system prompt (used by the streaming endpoint). Mirrors the prompt of /chat/message
# so the existing endpoint stays untouched.
BASE_CHAT_SYSTEM = """Tu es NEURA AL-NOUR (نور), un assistant IA intelligent et bienveillant avec une expertise en Islam.

Tu combines:
- L'intelligence artificielle conversationnelle moderne
- Une connaissance approfondie de l'Islam (Coran, Hadiths, Fiqh, Histoire islamique)
- Un accompagnement spirituel pendant le Ramadan et les Aïd

Règles importantes:
1. Sois respectueux et bienveillant
2. Pour les questions islamiques, cite tes sources quand possible (Coran, Hadith)
3. Rappelle que tu n'es pas une autorité religieuse - conseille de consulter un imam pour les questions complexes
4. Réponds en français par défaut, mais adapte-toi à la langue de l'utilisateur
5. Si on te manque de respect, avertis poliment une fois, puis refuse de continuer
6. Si l'utilisateur envoie une image, analyse-la attentivement et décris ce que tu vois

بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"""


def current_ai_context() -> str:
    """Build request-time context so long-running workers never keep a stale date."""
    now, timezone_label = current_server_time()
    return (
        "\n\n=== CONTEXTE TEMPOREL FIABLE ===\n"
        f"Date et heure actuelles du serveur : {now.strftime('%Y-%m-%d %H:%M:%S')} "
        f"(fuseau {timezone_label}).\n"
        f"Nous sommes en {now.year}. Cette date dynamique prévaut sur toute date de connaissance "
        "interne du modèle. Ne prétends jamais être dans une autre année si cela la "
        "contredit. Pour une actualité, une météo, un score ou tout fait récent, ne donne une "
        "réponse précise que si des résultats Web fournis dans cette requête la confirment. "
        "Sinon, indique clairement que l'information actuelle n'a pas pu être vérifiée.\n"
        "=================================\n"
    )


def current_server_time():
    try:
        now = datetime.now(ZoneInfo("Europe/Paris"))
        timezone_label = "Europe/Paris"
    except ZoneInfoNotFoundError:
        now = datetime.now().astimezone()
        timezone_label = str(now.tzinfo or "heure locale du serveur")
    return now, timezone_label


def _current_date_direct_answer(user_text: str, lang: Optional[str] = None) -> Optional[str]:
    """Answer simple current-date questions from the server clock, bypassing stale LLM context."""
    text = (user_text or "").strip().lower()
    normalized = (
        text.replace("é", "e")
        .replace("è", "e")
        .replace("ê", "e")
        .replace("à", "a")
        .replace("ù", "u")
        .replace("ç", "c")
    )
    asks_date = any(marker in normalized for marker in (
        "quelle date", "quel date", "on est quel", "on et quel",
        "on est quelle", "nous sommes quel", "nous sommes quelle",
        "date aujourd", "jour sommes", "annee sommes", "quel jour",
        "what date", "current date", "today's date", "what day is it",
    ))
    if not asks_date:
        return None

    now, timezone_label = current_server_time()
    weekdays = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
    months = [
        "janvier", "fevrier", "mars", "avril", "mai", "juin",
        "juillet", "aout", "septembre", "octobre", "novembre", "decembre",
    ]
    date_fr = f"{weekdays[now.weekday()]} {now.day} {months[now.month - 1]} {now.year}"
    if lang and str(lang).lower().startswith("en"):
        return f"Today is {now.strftime('%A, %B %d, %Y')} ({timezone_label})."
    return f"Nous sommes aujourd'hui le {date_fr} ({timezone_label})."


async def _save_direct_chat_answer(conversation_id: str, user_id: str, answer: str):
    await db.messages.insert_one({
        "id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "user_id": user_id,
        "role": "assistant",
        "content": answer,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.conversations.update_one(
        {"id": conversation_id},
        {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )


async def _safe_background_db_write(awaitable, label: str):
    try:
        await awaitable
    except Exception as exc:
        logger.error("%s background write failed: %s", label, str(exc)[:200])


def web_results_context(sources: list) -> str:
    if not sources:
        return (
            "\n\nRECHERCHE WEB : aucun résultat exploitable n'a été récupéré. "
            "N'invente aucune information actuelle et réponds clairement que la vérification "
            "Web a échoué ou que tu ne peux pas confirmer le fait demandé."
        )
    answer = next((source.get("search_answer", "") for source in sources if source.get("search_answer")), "")
    answer_context = f"\nSynthèse de recherche sourcée : {answer}\n" if answer else ""
    block = "\n\n".join(
        f"[{i}] {source['title']}\n{source['url']}\n"
        f"{source.get('published_date', '')}\n{source['snippet']}"
        for i, source in enumerate(sources, 1)
    )
    return (
        "\n\nRÉSULTATS WEB RÉCUPÉRÉS POUR CETTE REQUÊTE :\n"
        f"{answer_context}{block}\n\nUtilise ces résultats comme base pour les faits récents et cite [1], [2], etc. "
        "Ne complète pas un score, une date ou une actualité avec ta mémoire si les sources ne "
        "les confirment pas. Si elles sont insuffisantes ou contradictoires, dis-le explicitement."
    )
MODEL_PROFILES = {
    "chatgpt": {
        "label": "ChatGPT",
        "provider": "openai",
        "model_id": "gpt-4o",
        "persona": (
            "STYLE DE RÉPONSE — Direct et structuré :\n"
            "- Va droit au but, oriente vers la solution.\n"
            "- Structure tes réponses : titres courts, listes à puces, étapes numérotées quand c'est utile.\n"
            "- Phrases nettes, pas de remplissage. Conclus par l'action concrète à retenir."
        ),
        "params": {"max_tokens": 1024, "temperature": 0.4},
    },
    "claude": {
        "label": "Claude",
        "provider": "anthropic",
        "model_id": "claude-sonnet-4-5",
        "persona": (
            "STYLE DE RÉPONSE — Réfléchi et nuancé :\n"
            "- Explique ton raisonnement, montre les nuances et les différents angles.\n"
            "- Reconnais les zones d'incertitude plutôt que de trancher abusivement.\n"
            "- Ton posé, pédagogue, qui accompagne la réflexion de l'utilisateur."
        ),
        "params": {"max_tokens": 1024, "temperature": 0.6},
    },
    "gemini": {
        "label": "Gemini",
        "provider": "gemini",
        "model_id": "gemini-2.5-flash",
        "persona": (
            "STYLE DE RÉPONSE — Synthétique et factuel :\n"
            "- Réponses concises, allant à l'essentiel.\n"
            "- Privilégie les faits, les données et les définitions claires.\n"
            "- Peu de digressions : information dense, formulation efficace."
        ),
        "params": {"max_tokens": 1024, "temperature": 0.3},
    },
    "grok": {
        "label": "Grok",
        "provider": "gemini",
        "model_id": "gemini-2.5-flash",
        "persona": (
            "STYLE DE RÉPONSE — Cash et direct :\n"
            "- Ton franc et décontracté, sans langue de bois.\n"
            "- Une pointe d'humour bienvenue quand le sujet s'y prête, toujours avec respect.\n"
            "- Reste percutant mais courtois : jamais d'insultes, de vulgarité, ni rien de choquant "
            "dans le contexte islamique de l'application.\n"
            "- Réponses vivantes, qui ne tournent pas autour du pot."
        ),
        "params": {"max_tokens": 1024, "temperature": 0.9},
    },
}

# VIP Admin accounts - loaded from environment variables
VIP_ADMINS = [
    {"email": os.environ.get("VIP_ADMIN_1_EMAIL", ""), "password": os.environ.get("VIP_ADMIN_1_PASSWORD", "")},
    {"email": os.environ.get("VIP_ADMIN_2_EMAIL", ""), "password": os.environ.get("VIP_ADMIN_2_PASSWORD", "")}
]

# Subscription Plans
SUBSCRIPTION_PLANS = {
    "free": {"name": "Gratuit", "price_monthly": 0, "price_yearly": 0, "features": ["unlimited_text", "islamic_module", "quiz"]},
    "comme_toi": {"name": "Comme Toi", "price_monthly": 4.99, "price_yearly": 49.99, "features": ["history_50", "image_1_day", "themes", "encrypted"]},
    "mongo": {"name": "Mongo", "price_monthly": 8.99, "price_yearly": 89.99, "features": ["unlimited_screens", "unlimited_images", "full_history", "detailed_responses", "export"]},
    "pro": {"name": "Pro", "price_monthly": 14.99, "price_yearly": 89.99, "features": ["priority", "fast_responses", "coaching", "premium_themes", "adhan_hd", "offline", "memorization", "stats"]},
    "developer": {"name": "Développeur", "price_monthly": 19.99, "price_yearly": 119.99, "features": ["api_access", "sdk", "webhooks", "dashboard", "analytics"]},
    "neura_plus": {"name": "Neura+", "price_monthly": 119.99, "price_yearly": 1199.99, "features": ["dev_workspace", "code_advanced", "multi_file", "project_analysis", "dev_memory", "audit", "priority"]},
    "neura_ultra": {"name": "Neura Ultra", "price_monthly": 299.99, "price_yearly": 2999.99, "features": ["dev_workspace", "code_max", "massive_generation", "full_project_analysis", "dev_agent", "security_audit", "max_memory", "experimental", "max_priority"]}
}

# ============== DEVELOPER AI (Code assistant) ==============
# Founder / VIP accounts: full free access, treated as the top tier.
FOUNDER_EMAILS = {
    "kaddanaminpro@gmail.com",
    "kaddanwalidpro@gmail.com",
    "zeroxigamer@gmail.com",
}

def is_founder(email: Optional[str]) -> bool:
    return (email or "").strip().lower() in FOUNDER_EMAILS

def is_vip_email(email: Optional[str]) -> bool:
    """VIP/founder emails (founders list + env VIP admins) -> always top tier (Neura Ultra)."""
    e = (email or "").strip().lower()
    if e in FOUNDER_EMAILS:
        return True
    return any(((a.get("email") or "").strip().lower() == e) for a in VIP_ADMINS if a.get("email"))

# Developer tiers. Limits are by request count / response size / files / memory
# (single AI engine = Gemini; no extra paid provider). window_hours = regeneration delay.
DEV_TIERS = {
    "free":  {"label": "Gratuit",     "requests": 5,    "window_hours": 4, "max_tokens": 1024, "max_files": 2,  "memory_turns": 6,  "project_analysis": False},
    "plus":  {"label": "Neura+",      "requests": 150,  "window_hours": 1, "max_tokens": 4096, "max_files": 10, "memory_turns": 30, "project_analysis": True},
    "ultra": {"label": "Neura Ultra", "requests": 1000, "window_hours": 1, "max_tokens": 8192, "max_files": 30, "memory_turns": 60, "project_analysis": True},
}

def get_dev_tier(user: dict) -> str:
    """Resolve a user's developer tier (founders/VIP -> ultra)."""
    if user.get("is_vip") or is_vip_email(user.get("email")):
        return "ultra"
    sub = user.get("subscription", "free")
    if sub == "neura_ultra":
        return "ultra"
    if sub == "neura_plus":
        return "plus"
    return "free"

def _dev_is_unlimited(user: dict) -> bool:
    return bool(user.get("is_vip") or is_vip_email(user.get("email")))

def _is_premium_ai(user: dict) -> bool:
    """True if the user may use the real paid models (GPT-4o / Claude).
    Free / standard plans stay on Gemini for cost control."""
    if user.get("is_vip") or is_vip_email(user.get("email")):
        return True
    return user.get("subscription") in ("neura_plus", "neura_ultra")

# Security
security = HTTPBearer(auto_error=False)

# Create the main app
app = FastAPI(title="NEURA AL-NOUR API", version="1.0.0")

# Create router with /api prefix
api_router = APIRouter(prefix="/api")

SYSTEM_MODULES = [
    {"name": "auth", "scope": "Connexion classique, Google, sessions JWT", "collections": ["users", "auth_sessions"]},
    {"name": "chat", "scope": "Assistant IA, recherche Web, images utilisateur", "collections": ["conversations", "messages"]},
    {"name": "quran", "scope": "Lecteur Coran existant, sourates, traduction, audio", "collections": []},
    {"name": "quiz", "scope": "Quiz solo et multijoueur", "collections": ["quiz_sessions", "multiplayer_rooms", "multiplayer_history"]},
    {"name": "islam_learning", "scope": "Academie de l'Islam, progression, notes, favoris", "collections": ["islam_learning_progress", "islam_learning_notes", "islam_messages"]},
    {"name": "language_tutor", "scope": "Professeur de langues IA et progression", "collections": ["lang_messages", "lang_progress"]},
    {"name": "developer", "scope": "Workspace developpeur IA, quotas, fichiers", "collections": ["developer_sessions", "developer_messages", "dev_files"]},
    {"name": "admin", "scope": "Panel fondateur, logs, recompenses, signalements", "collections": ["founder_admin_logs", "founder_rewards", "multiplayer_question_reports"]},
    {"name": "payments", "scope": "Abonnements Stripe", "collections": ["payment_transactions"]},
    {"name": "videos", "scope": "Rappels video statiques", "collections": []},
]

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), geolocation=(self), microphone=(self)",
}


@app.middleware("http")
async def system_safety_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception as error:
        elapsed_ms = round((time.perf_counter() - start) * 1000)
        logger.exception(f"Unhandled request error {request_id}: {error}")
        try:
            await db.system_logs.insert_one({
                "id": str(uuid.uuid4()),
                "type": "unhandled_error",
                "request_id": request_id,
                "path": request.url.path,
                "method": request.method,
                "elapsed_ms": elapsed_ms,
                "error": str(error)[:500],
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
        response = JSONResponse(status_code=500, content={"detail": "Erreur serveur controlee.", "request_id": request_id})
    elapsed_ms = round((time.perf_counter() - start) * 1000)
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Response-Time-ms"] = str(elapsed_ms)
    for key, value in SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    if elapsed_ms >= 2000 and request.url.path.startswith("/api"):
        try:
            await db.system_logs.insert_one({
                "id": str(uuid.uuid4()),
                "type": "slow_request",
                "request_id": request_id,
                "path": request.url.path,
                "method": request.method,
                "status_code": response.status_code,
                "elapsed_ms": elapsed_ms,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass
    return response

# ============== MODELS ==============

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    name: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    subscription: str
    is_vip: bool
    created_at: str

class MessageCreate(BaseModel):
    content: str
    conversation_id: Optional[str] = None
    image_base64: Optional[str] = None
    document_name: Optional[str] = None
    document_text: Optional[str] = None
    model: Optional[str] = None
    lang: Optional[str] = None
    web_search: Optional[bool] = False

class AiMemoryCreate(BaseModel):
    label: str = Field(..., min_length=2, max_length=80)
    value: str = Field(..., min_length=2, max_length=500)

class ConversationResponse(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str

class ChatResponse(BaseModel):
    message: str
    conversation_id: str

class ImageGenerateRequest(BaseModel):
    prompt: str

class QuizQuestion(BaseModel):
    question: str
    options: List[str]
    correct_answer: int
    category: str

class QuizAnswerRequest(BaseModel):
    question_id: str
    answer: int

class SubscriptionRequest(BaseModel):
    plan: str
    billing_period: str  # monthly or yearly
    origin_url: str

# ============== HELPERS ==============

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    # Defensive: a Google-auth account has no password hash (None).
    # Never call bcrypt with None/empty — return False instead of crashing.
    if not password or not hashed:
        return False
    return bcrypt.checkpw(password.encode(), hashed.encode())

def create_token(user_id: str, email: str, is_vip: bool = False) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "is_vip": is_vip,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Non authentifié")
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0})
        if not user:
            raise HTTPException(status_code=401, detail="Utilisateur non trouvé")
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expiré")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token invalide")

async def get_optional_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        return None
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user = await db.users.find_one({"id": payload["user_id"]}, {"_id": 0})
        return user
    except:
        return None

def check_subscription_feature(user: dict, feature: str) -> bool:
    """Check if user's subscription includes a feature"""
    if user.get("is_vip") or is_vip_email(user.get("email")):
        return True
    subscription = user.get("subscription", "free")
    plan = SUBSCRIPTION_PLANS.get(subscription, SUBSCRIPTION_PLANS["free"])
    return feature in plan.get("features", [])

# ============== AUTH ROUTES ==============

# Google OAuth Session endpoint
@api_router.post("/auth/google/session")
async def google_auth_session(request: Request):
    """Exchange Google OAuth session_id for user session"""
    started_at = time.perf_counter()
    try:
        body = await request.json()
        session_id = body.get("session_id")
        
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id requis")
        
        # Call Emergent Auth to get user data
        external_started_at = time.perf_counter()
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0)) as client:
            response = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": session_id}
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=401, detail="Session invalide")
            
            google_data = response.json()
        external_ms = round((time.perf_counter() - external_started_at) * 1000)
        
        email = google_data.get("email")
        name = google_data.get("name")
        picture = google_data.get("picture")
        session_token = google_data.get("session_token")
        
        # Check founder/VIP accounts: they must get the top tier even through Google auth.
        is_vip = is_vip_email(email)
        
        # Check if user exists
        existing_user = await db.users.find_one({"email": email}, {"_id": 0})
        
        if existing_user:
            user_id = existing_user["id"]
            subscription = "neura_ultra" if is_vip else existing_user.get("subscription", "free")
            user_write = db.users.update_one(
                {"email": email},
                {"$set": {
                    "name": name,
                    "picture": picture,
                    "is_vip": is_vip,
                    "subscription": subscription
                }}
            )
            user_write_required = False
        else:
            # Create new user
            user_id = str(uuid.uuid4())
            user = {
                "id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "password": None,  # Google auth users don't have password
                "subscription": "neura_ultra" if is_vip else "free",
                "is_vip": is_vip,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "screens_today": 0,
                "images_today": 0,
                "last_reset": datetime.now(timezone.utc).date().isoformat()
            }
            subscription = user["subscription"]
            user_write = db.users.insert_one(user)
            user_write_required = True
        
        # Store session in database
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)
        session_write = db.user_sessions.update_one(
            {"user_id": user_id},
            {"$set": {
                "user_id": user_id,
                "session_token": session_token,
                "expires_at": expires_at.isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat()
            }},
            upsert=True
        )
        database_started_at = time.perf_counter()
        if user_write_required:
            await user_write
        else:
            asyncio.create_task(_safe_background_db_write(user_write, "google_user_update"))
        asyncio.create_task(_safe_background_db_write(session_write, "google_session"))
        database_ms = round((time.perf_counter() - database_started_at) * 1000)
        
        # Create JWT token
        token = create_token(user_id, email, is_vip)
        
        total_ms = round((time.perf_counter() - started_at) * 1000)
        logger.info(
            "Google auth timing external_ms=%s database_ms=%s total_ms=%s",
            external_ms,
            database_ms,
            total_ms,
        )
        
        return {
            "token": token,
            "session_token": session_token,
            "user": {
                "id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "subscription": subscription,
                "is_vip": is_vip
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Google auth error: {e}")
        raise HTTPException(status_code=500, detail="Erreur d'authentification Google")

@api_router.post("/auth/register")
async def register(user_data: UserCreate):
    # Check if email exists
    existing = await db.users.find_one({"email": user_data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email déjà utilisé")
    
    # Check if VIP admin / founder -> top tier (Neura Ultra)
    is_vip = is_vip_email(user_data.email)
    
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "email": user_data.email,
        "name": user_data.name,
        "password": hash_password(user_data.password),
        "subscription": "neura_ultra" if is_vip else "free",  # VIP/founders = Neura Ultra (tout débloqué)
        "is_vip": is_vip,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "screens_today": 0,
        "images_today": 0,
        "last_reset": datetime.now(timezone.utc).date().isoformat()
    }
    
    await db.users.insert_one(user)
    
    # Send welcome email
    try:
        await asyncio.to_thread(resend.Emails.send, {
            "from": SENDER_EMAIL,
            "to": [user_data.email],
            "subject": "Bienvenue sur NEURA AL-NOUR نور",
            "html": f"""
            <h1>Bienvenue {user_data.name}!</h1>
            <p>Votre compte NEURA AL-NOUR a été créé avec succès.</p>
            <p>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</p>
            <p>Découvrez notre assistant IA islamique intelligent.</p>
            """
        })
    except Exception as e:
        logger.error(f"Failed to send welcome email: {e}")
    
    token = create_token(user_id, user_data.email, is_vip)
    
    return {
        "token": token,
        "user": {
            "id": user_id,
            "email": user_data.email,
            "name": user_data.name,
            "subscription": user["subscription"],
            "is_vip": is_vip
        }
    }

@api_router.post("/auth/login")
async def login(credentials: UserLogin):
    user = await db.users.find_one({"email": credentials.email}, {"_id": 0})
    
    # Check VIP admin login
    vip_admin = next((admin for admin in VIP_ADMINS if admin["email"] == credentials.email), None)
    
    if not user:
        # Auto-create VIP admin account if doesn't exist
        if vip_admin and credentials.password == vip_admin["password"]:
            user_id = str(uuid.uuid4())
            user = {
                "id": user_id,
                "email": credentials.email,
                "name": "Admin VIP",
                "password": hash_password(credentials.password),
                "subscription": "developer",
                "is_vip": True,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "screens_today": 0,
                "images_today": 0,
                "last_reset": datetime.now(timezone.utc).date().isoformat()
            }
            await db.users.insert_one(user)
        else:
            raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    else:
        # Verify password
        if vip_admin and credentials.password == vip_admin["password"]:
            # VIP admin with predefined password
            pass
        elif not user.get("password"):
            # Google-auth account (no password): classic email/password login
            # is not applicable. Return a clean 401, never crash on password=None.
            raise HTTPException(
                status_code=401,
                detail="Ce compte utilise la connexion Google. Veuillez vous connecter avec Google."
            )
        elif not verify_password(credentials.password, user["password"]):
            raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    
    token = create_token(user["id"], user["email"], user.get("is_vip", False))
    
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "subscription": user.get("subscription", "free"),
            "is_vip": user.get("is_vip", False)
        }
    }

@api_router.get("/auth/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "subscription": user.get("subscription", "free"),
        "is_vip": user.get("is_vip", False)
    }

@api_router.get("/ai/memory")
async def get_ai_memory(user: dict = Depends(get_current_user)):
    return await db.ai_memories.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("updated_at", -1).to_list(100)

@api_router.post("/ai/memory")
async def create_ai_memory(data: AiMemoryCreate, user: dict = Depends(get_current_user)):
    if not _is_safe_memory_value(f"{data.label} {data.value}"):
        raise HTTPException(status_code=400, detail="Les secrets, cles API, tokens et mots de passe ne doivent pas etre memorises.")
    now = datetime.now(timezone.utc).isoformat()
    memory = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "label": data.label.strip()[:80],
        "value": data.value.strip()[:500],
        "source": "manual",
        "created_at": now,
        "updated_at": now,
    }
    await db.ai_memories.insert_one(memory)
    return {k: v for k, v in memory.items() if k != "_id"}

@api_router.delete("/ai/memory/{memory_id}")
async def delete_ai_memory(memory_id: str, user: dict = Depends(get_current_user)):
    result = await db.ai_memories.delete_one({"id": memory_id, "user_id": user["id"]})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Memoire introuvable.")
    return {"ok": True}

# ============== CHAT ROUTES ==============

SENSITIVE_MEMORY_MARKERS = ("api_key", "apikey", "token", "password", "mot de passe", "secret", "sk-", "ghp_", "vcp_", "rnd_")


def _extract_explicit_memory_request(text: str) -> Optional[str]:
    raw = (text or "").strip()
    lowered = raw.lower()
    triggers = [
        "souviens-toi que ",
        "souviens toi que ",
        "retiens que ",
        "memorise que ",
        "mÃ©morise que ",
        "remember that ",
    ]
    for trigger in triggers:
        if trigger in lowered:
            start = lowered.index(trigger) + len(trigger)
            return raw[start:].strip(" .\n\t")
    return None


def _is_safe_memory_value(value: str) -> bool:
    lowered = (value or "").lower()
    return bool(value.strip()) and not any(marker in lowered for marker in SENSITIVE_MEMORY_MARKERS)


async def _save_ai_memory_from_text(user: dict, text: str) -> Optional[dict]:
    value = _extract_explicit_memory_request(text)
    if not value:
        return None
    if not _is_safe_memory_value(value):
        return {"blocked": True, "reason": "sensitive"}
    now = datetime.now(timezone.utc).isoformat()
    memory = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "label": "preference",
        "value": value[:500],
        "source": "explicit_chat_request",
        "created_at": now,
        "updated_at": now,
    }
    await db.ai_memories.insert_one(memory)
    return memory


async def _ai_memory_context(user: dict) -> str:
    memories = await db.ai_memories.find(
        {"user_id": user["id"]}, {"_id": 0, "label": 1, "value": 1}
    ).sort("updated_at", -1).to_list(12)
    if not memories:
        return ""
    lines = [f"- {item.get('label', 'memoire')}: {item.get('value', '')}" for item in memories if item.get("value")]
    if not lines:
        return ""
    return (
        "\n\nMEMOIRE UTILISATEUR AUTORISEE :\n"
        "Utilise uniquement ces informations explicitement enregistrees par l'utilisateur. "
        "Ne revele pas cette liste sauf si l'utilisateur demande a voir sa memoire.\n"
        + "\n".join(lines)
    )


@api_router.post("/chat/message")
async def send_message(message: MessageCreate, user: dict = Depends(get_current_user)):
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    
    # Check screen limit for free users
    if message.image_base64 and not user.get("is_vip"):
        subscription = user.get("subscription", "free")
        if subscription == "free":
            # Check if already sent screen in this conversation
            if message.conversation_id:
                existing_screen = await db.messages.find_one({
                    "conversation_id": message.conversation_id,
                    "has_image": True,
                    "user_id": user["id"]
                })
                if existing_screen:
                    raise HTTPException(
                        status_code=403,
                        detail="Vous avez envoyé une capture d'écran. Pour analyser des images sans restriction et continuer dans cette conversation, passez en Premium. Vous pouvez ouvrir une nouvelle discussion pour continuer gratuitement."
                    )
    
    # Create or get conversation
    conversation_id = message.conversation_id
    if not conversation_id:
        conversation_id = str(uuid.uuid4())
        await db.conversations.insert_one({
            "id": conversation_id,
            "user_id": user["id"],
            "title": message.content[:50] + "..." if len(message.content) > 50 else message.content,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        })
    
    # Save user message
    user_msg_id = str(uuid.uuid4())
    await db.messages.insert_one({
        "id": user_msg_id,
        "conversation_id": conversation_id,
        "user_id": user["id"],
        "role": "user",
        "content": message.content,
        "has_image": bool(message.image_base64),
        "created_at": datetime.now(timezone.utc).isoformat()
    })

    document_context = ""
    if message.document_text:
        clean_doc_name = (message.document_name or "document").strip()[:120]
        clean_doc_text = message.document_text[:20000]
        document_context = (
            f"\n\nDOCUMENT FOURNI PAR L'UTILISATEUR ({clean_doc_name}) :\n"
            "```text\n"
            f"{clean_doc_text}\n"
            "```\n"
            "Analyse ce document uniquement comme contexte fourni par l'utilisateur. "
            "Ne prétends pas avoir lu un fichier externe au-delà de ce contenu."
        )

    direct_answer = None if (message.image_base64 or message.document_text) else _current_date_direct_answer(message.content, message.lang)
    if direct_answer:
        await _save_direct_chat_answer(conversation_id, user["id"], direct_answer)
        return {
            "message": direct_answer,
            "conversation_id": conversation_id,
            "sources": [],
        }

    memory_result = await _save_ai_memory_from_text(user, message.content)
    
    # Get conversation history for context
    history = await db.messages.find(
        {"conversation_id": conversation_id},
        {"_id": 0}
    ).sort("created_at", 1).to_list(50)
    
    # Build chat with LLM
    system_message = """Tu es NEURA AL-NOUR (نور), un assistant IA intelligent et bienveillant avec une expertise en Islam.
    
Tu combines:
- L'intelligence artificielle conversationnelle moderne
- Une connaissance approfondie de l'Islam (Coran, Hadiths, Fiqh, Histoire islamique)
- Un accompagnement spirituel pendant le Ramadan et les Aïd

Règles importantes:
1. Sois respectueux et bienveillant
2. Pour les questions islamiques, cite tes sources quand possible (Coran, Hadith)
3. Rappelle que tu n'es pas une autorité religieuse - conseille de consulter un imam pour les questions complexes
4. Réponds en français par défaut, mais adapte-toi à la langue de l'utilisateur
5. Si on te manque de respect, avertis poliment une fois, puis refuse de continuer
6. Si l'utilisateur envoie une image, analyse-la attentivement et décris ce que tu vois

بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ""" + current_ai_context() + await _ai_memory_context(user)
    system_message += document_context
    if memory_result and memory_result.get("blocked"):
        system_message += "\n\nL'utilisateur a demande d'enregistrer une memoire sensible. Refuse de memoriser des secrets et explique que les cles, tokens et mots de passe ne doivent pas etre stockes."
    elif memory_result:
        system_message += "\n\nConfirme brievement que cette preference a ete memorisee, sans en faire trop."

    sources = []
    if message.web_search:
        try:
            sources = await tavily_search(message.content, max_results=5)
        except Exception as exc:
            logger.error(f"Tavily (message/vision) error: {exc}")
            sources = []
        system_message += web_results_context(sources)
    
    # Send current message with or without image. Retry transient Gemini blips
    # (429 rate spike / 503 high-demand) with backoff; the chat is rebuilt each
    # attempt so no message is ever duplicated.
    response = None
    last_err = None
    for attempt in range(3):
        try:
            if message.image_base64:
                # Use FileContent with content_type="image" for vision
                from emergentintegrations.llm.chat import FileContent
            
                # Prepare image data - ensure proper format
                image_data = message.image_base64
                # Remove data URL prefix if present
                if image_data.startswith('data:'):
                    parts = image_data.split(',', 1)
                    image_data = parts[1] if len(parts) > 1 else image_data
            
                # Apply the active language instruction to the vision system prompt as well.
                vision_system = system_message + MODERATION_GUARD + IDENTITY_GUARD
                if message.lang:
                    vision_system += (
                        f"\n\nLANGUE : réponds toujours en {message.lang}, "
                        "quelle que soit la langue de la question."
                    )
                # Use Gemini for vision support (native, free image analysis)
                chat = LlmChat(
                    api_key=AI_LLM_KEY,
                    session_id=f"neura_{conversation_id}_vision",
                    system_message=vision_system
                ).with_model("gemini", "gemini-2.5-flash").with_params(max_tokens=1024)
            
                # Add text message first, then image
                text_content = message.content if message.content else "Analyse cette image s'il te plaît."
            
                # Create FileContent with content_type="image" for image analysis
                user_msg = UserMessage(
                    text=text_content,
                    file_contents=[FileContent(content_type="image", file_content_base64=image_data)]
                )
                response = await chat.send_message(user_msg)
            else:
                # Resolve the selected model profile (Claude model + persona overlay).
                profile = MODEL_PROFILES.get(message.model, MODEL_PROFILES[DEFAULT_MODEL])
                # Cost control: only Neura+/Ultra (and founders/VIP) get the real paid
                # models (GPT-4o / Claude). Everyone else keeps the STYLE but runs on Gemini.
                if not _is_premium_ai(user):
                    profile = {**profile, "provider": "gemini", "model_id": "gemini-2.5-flash"}
                persona_system = system_message + "\n\n" + profile["persona"] + "\n\n" + STYLE_PRECEDENCE + MODERATION_GUARD + IDENTITY_GUARD
                if message.lang:
                    persona_system += (
                        f"\n\nLANGUE : réponds toujours en {message.lang}, "
                        "quelle que soit la langue de la question."
                    )
                # Build the conversation history as initial_messages so the model
                # receives the full context in a SINGLE request. (Previously the
                # history was replayed by issuing one blocking LLM call per past
                # message, which delayed the answer by tens of seconds and blew past
                # Gemini's free-tier limit of 5 requests/minute, triggering 429
                # retries that compounded into a 30-60s wait.)
                initial_messages = [{"role": "system", "content": persona_system}]
                for msg in history[:-1]:  # Exclude the message we just added
                    if msg.get("role") in ("user", "assistant") and msg.get("content"):
                        initial_messages.append({"role": msg["role"], "content": msg["content"]})
                # Use emergentintegrations for text-only messages
                chat = LlmChat(
                    api_key=AI_LLM_KEY,
                    session_id=f"neura_{conversation_id}",
                    system_message=persona_system,
                    initial_messages=initial_messages
                ).with_model(profile.get("provider", "gemini"), profile["model_id"]).with_params(**profile["params"])
            
                # History already provided via initial_messages above -> single LLM call.
                response = await chat.send_message(UserMessage(text=message.content))
            last_err = None
            break
        except Exception as e:
            last_err = e
            es = str(e)
            transient = ("429" in es or "503" in es or "RESOURCE_EXHAUSTED" in es or "UNAVAILABLE" in es or "rate" in es.lower())
            if transient and attempt < 2:
                await asyncio.sleep(2 + attempt * 3)
                continue
            break

    if last_err is not None:
        es = str(last_err)
        logger.error(f"LLM error: {es[:300]}")
        if any(x in es for x in ("RESOURCE_EXHAUSTED", "PerDay", "PerMinute", "quota", "429")):
            raise HTTPException(status_code=429, detail="Quota IA gratuit atteint pour le moment (limite du palier gratuit, partagée par l'app). Réessaie dans une minute.")
        raise HTTPException(status_code=503, detail="Service IA temporairement indisponible. Veuillez réessayer.")
    
    # Save AI response
    ai_msg_id = str(uuid.uuid4())
    await db.messages.insert_one({
        "id": ai_msg_id,
        "conversation_id": conversation_id,
        "user_id": user["id"],
        "role": "assistant",
        "content": response,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    # Update conversation
    await db.conversations.update_one(
        {"id": conversation_id},
        {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()}}
    )
    
    return {
        "message": response,
        "conversation_id": conversation_id,
        "sources": sources,
    }


async def tavily_search(query: str, max_results: int = 5):
    """Run a web search via Tavily. Returns a list of {title, url, snippet}."""
    api_key = os.environ.get('TAVILY_API_KEY')
    if not api_key:
        return []
    now, _ = current_server_time()
    dated_query = (
        f"{query}\nDate actuelle : {now.strftime('%Y-%m-%d')}. "
        "Privilégier les informations les plus récentes et les résultats finaux confirmés."
    )
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "query": dated_query,
                "max_results": max_results,
                "auto_parameters": True,
                "include_answer": "advanced",
                "include_raw_content": False,
            },
        )
        resp.raise_for_status()
        data = resp.json()
    search_answer = data.get("answer", "")
    results = [
        {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "snippet": str(r.get("content", ""))[:1500],
            "published_date": r.get("published_date", ""),
            "search_answer": "",
        }
        for r in data.get("results", [])
        if str(r.get("url", "")).startswith(("http://", "https://"))
    ]
    if results and search_answer:
        results[0]["search_answer"] = search_answer
    return results


@api_router.post("/chat/stream")
async def chat_stream(message: MessageCreate, user: dict = Depends(get_current_user)):
    """Streaming chat endpoint (SSE). When web_search is on, emits real phase events:
    searching -> reading_sources -> writing -> done, plus token deltas during writing."""

    def sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    async def event_generator():
        from emergentintegrations.llm.chat import LlmChat, UserMessage
        try:
            # Create or get conversation
            conversation_id = message.conversation_id
            if not conversation_id:
                conversation_id = str(uuid.uuid4())
                await db.conversations.insert_one({
                    "id": conversation_id,
                    "user_id": user["id"],
                    "title": message.content[:50] + "..." if len(message.content) > 50 else message.content,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
            yield sse({"type": "conversation", "conversation_id": conversation_id})

            # Save user message
            await db.messages.insert_one({
                "id": str(uuid.uuid4()),
                "conversation_id": conversation_id,
                "user_id": user["id"],
                "role": "user",
                "content": message.content,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

            direct_answer = _current_date_direct_answer(message.content, message.lang)
            if direct_answer:
                await _save_direct_chat_answer(conversation_id, user["id"], direct_answer)
                yield sse({"type": "phase", "phase": "writing"})
                yield sse({"type": "delta", "content": direct_answer})
                yield sse({"type": "done", "conversation_id": conversation_id, "sources": []})
                return

            # Conversation history (exclude the message we just saved)
            history = await db.messages.find(
                {"conversation_id": conversation_id}, {"_id": 0}
            ).sort("created_at", 1).to_list(50)

            # Build the system prompt (model persona + precedence + active language)
            profile = MODEL_PROFILES.get(message.model, MODEL_PROFILES[DEFAULT_MODEL])
            # Cost control: real paid models (GPT-4o / Claude) only for Neura+/Ultra/founders.
            if not _is_premium_ai(user):
                profile = {**profile, "provider": "gemini", "model_id": "gemini-2.5-flash"}
            memory_result = await _save_ai_memory_from_text(user, message.content)
            memory_context = await _ai_memory_context(user)
            system_prompt = BASE_CHAT_SYSTEM + current_ai_context() + memory_context + "\n\n" + profile["persona"] + "\n\n" + STYLE_PRECEDENCE + MODERATION_GUARD + IDENTITY_GUARD
            if memory_result and memory_result.get("blocked"):
                system_prompt += "\n\nL'utilisateur a demande d'enregistrer une memoire sensible. Refuse de memoriser des secrets et explique que les cles, tokens et mots de passe ne doivent pas etre stockes."
            elif memory_result:
                system_prompt += "\n\nConfirme brievement que cette preference a ete memorisee, sans en faire trop."
            if message.lang:
                system_prompt += (
                    f"\n\nLANGUE : réponds toujours en {message.lang}, "
                    "quelle que soit la langue de la question."
                )

            # Optional web search (real phase events)
            sources = []
            user_text = message.content
            if message.web_search:
                yield sse({"type": "phase", "phase": "searching"})
                try:
                    sources = await tavily_search(message.content, max_results=5)
                except Exception as e:
                    logger.error(f"Tavily error: {e}")
                    sources = []
                yield sse({"type": "phase", "phase": "reading_sources", "sources": sources})
                system_prompt += web_results_context(sources)

            # initial_messages must include the system prompt first (the library does NOT
            # auto-add it when initial_messages is provided).
            initial_messages = [{"role": "system", "content": system_prompt}]
            for m in history[:-1]:
                if m.get("role") in ("user", "assistant") and m.get("content"):
                    initial_messages.append({"role": m["role"], "content": m["content"]})

            # Writing phase + real token streaming
            yield sse({"type": "phase", "phase": "writing"})
            chat = LlmChat(
                api_key=AI_LLM_KEY,
                session_id=f"neura_stream_{conversation_id}",
                system_message=system_prompt,
                initial_messages=initial_messages,
            ).with_model(profile.get("provider", "gemini"), profile["model_id"]).with_params(**profile["params"])

            full_text = []
            async for event in chat.stream_message(UserMessage(text=user_text)):
                delta = getattr(event, "content", None)
                if delta:
                    full_text.append(delta)
                    yield sse({"type": "delta", "content": delta})

            answer = "".join(full_text)

            # Save AI response
            await db.messages.insert_one({
                "id": str(uuid.uuid4()),
                "conversation_id": conversation_id,
                "user_id": user["id"],
                "role": "assistant",
                "content": answer,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            await db.conversations.update_one(
                {"id": conversation_id},
                {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
            )

            yield sse({"type": "done", "conversation_id": conversation_id, "sources": sources})
        except Exception as e:
            logger.error(f"Stream error: {e}")
            yield sse({"type": "error", "detail": "Service IA temporairement indisponible."})

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@api_router.get("/chat/conversations")
async def get_conversations(user: dict = Depends(get_current_user)):
    # Check history limit
    subscription = user.get("subscription", "free")
    limit = 50 if subscription == "comme_toi" else 1000
    if subscription == "free":
        limit = 10
    
    if user.get("is_vip"):
        limit = 1000
    
    conversations = await db.conversations.find(
        {"user_id": user["id"]},
        {"_id": 0}
    ).sort("updated_at", -1).to_list(limit)
    
    return conversations

@api_router.get("/chat/conversations/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: str, user: dict = Depends(get_current_user)):
    # Verify ownership
    conversation = await db.conversations.find_one(
        {"id": conversation_id, "user_id": user["id"]},
        {"_id": 0}
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation non trouvée")
    
    messages = await db.messages.find(
        {"conversation_id": conversation_id},
        {"_id": 0}
    ).sort("created_at", 1).to_list(1000)
    
    return messages

@api_router.delete("/chat/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str, user: dict = Depends(get_current_user)):
    result = await db.conversations.delete_one({"id": conversation_id, "user_id": user["id"]})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Conversation non trouvée")
    await db.messages.delete_many({"conversation_id": conversation_id})
    return {"success": True}

# ============== IMAGE GENERATION ==============

@api_router.get("/images/remaining")
async def get_remaining_generations(user: dict = Depends(get_current_user)):
    """Check how many free image generations the user has remaining"""
    subscription = user.get("subscription", "free")
    is_vip = user.get("is_vip", False)
    
    if is_vip or subscription in ("mongo", "pro", "developer"):
        return {"remaining": -1, "limit": -1, "unlimited": True}
    
    used = user.get("image_generations_count", 0)
    return {"remaining": max(0, 3 - used), "limit": 3, "unlimited": False}


@api_router.post("/images/generate")
async def generate_image(request: ImageGenerateRequest, user: dict = Depends(get_current_user)):
    subscription = user.get("subscription", "free")
    is_vip = user.get("is_vip", False)
    
    if not request.prompt or not request.prompt.strip():
        raise HTTPException(status_code=400, detail="Le prompt ne peut pas être vide")
    
    # VIP and mongo/pro/developer get unlimited
    if not is_vip and subscription not in ("mongo", "pro", "developer"):
        # Free and comme_toi: 3 total free generations
        used = user.get("image_generations_count", 0)
        if used >= 3:
            raise HTTPException(
                status_code=403, 
                detail="Vous avez utilisé vos 3 générations gratuites. Abonnez-vous au plan Mongo pour des générations illimitées."
            )
    
    try:
        # Image generation via OpenRouter (chat completions with an image-output model)
        image_model = "google/gemini-2.5-flash-image"
        images = []
        async with httpx.AsyncClient(timeout=120) as image_client:
            ai_response = await image_client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
                json={
                    "model": image_model,
                    "messages": [{"role": "user", "content": request.prompt}],
                    "modalities": ["image", "text"],
                },
            )
            ai_response.raise_for_status()
            result_images = ai_response.json()["choices"][0]["message"].get("images") or []
            for img in result_images:
                img_url = img["image_url"]["url"]
                if img_url.startswith("data:"):
                    images.append(img_url.split(",", 1)[1])
                else:
                    fetched = await image_client.get(img_url)
                    images.append(base64.b64encode(fetched.content).decode("utf-8"))
        
        if images and len(images) > 0:
            image_base64 = images[0]
            
            # Increment generation count for non-unlimited users
            if not is_vip and subscription not in ("mongo", "pro", "developer"):
                await db.users.update_one(
                    {"id": user["id"]},
                    {"$inc": {"image_generations_count": 1}}
                )
            
            return {"image_base64": image_base64}
        else:
            raise HTTPException(status_code=500, detail="Aucune image générée")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Image generation error: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur de génération: {str(e)}")

# ============== PRAYER TIMES ==============

@api_router.get("/prayer-times")
async def get_prayer_times(latitude: float, longitude: float, method: int = 2):
    """Get prayer times using Aladhan API"""
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            today = datetime.now(timezone.utc)
            url = f"https://api.aladhan.com/v1/timings/{int(today.timestamp())}"
            params = {
                "latitude": latitude,
                "longitude": longitude,
                "method": method  # 2 = ISNA
            }
            response = await client.get(url, params=params)
            data = response.json()
            
            if data.get("code") == 200:
                timings = data["data"]["timings"]
                return {
                    "fajr": timings["Fajr"],
                    "sunrise": timings["Sunrise"],
                    "dhuhr": timings["Dhuhr"],
                    "asr": timings["Asr"],
                    "maghrib": timings["Maghrib"],
                    "isha": timings["Isha"],
                    "date": data["data"]["date"]["readable"]
                }
            else:
                raise HTTPException(status_code=500, detail="Erreur API Aladhan")
    except Exception as e:
        logger.error(f"Prayer times error: {e}")
        raise HTTPException(status_code=500, detail="Impossible de récupérer les horaires")

@api_router.get("/prayer-times/month")
async def get_monthly_prayer_times(latitude: float, longitude: float, month: int, year: int, method: int = 2):
    """Get prayer times for a whole month"""
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            url = f"https://api.aladhan.com/v1/calendar/{year}/{month}"
            params = {
                "latitude": latitude,
                "longitude": longitude,
                "method": method
            }
            response = await client.get(url, params=params)
            data = response.json()
            
            if data.get("code") == 200:
                return data["data"]
            else:
                raise HTTPException(status_code=500, detail="Erreur API Aladhan")
    except Exception as e:
        logger.error(f"Monthly prayer times error: {e}")
        raise HTTPException(status_code=500, detail="Impossible de récupérer les horaires")

# ============== QIBLAH ==============

@api_router.get("/qiblah")
async def get_qiblah_direction(latitude: float, longitude: float):
    """Get Qiblah direction using Aladhan API"""
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            url = f"https://api.aladhan.com/v1/qibla/{latitude}/{longitude}"
            response = await client.get(url)
            data = response.json()
            
            if data.get("code") == 200:
                return {
                    "direction": data["data"]["direction"],
                    "latitude": latitude,
                    "longitude": longitude
                }
            else:
                raise HTTPException(status_code=500, detail="Erreur API Aladhan")
    except Exception as e:
        logger.error(f"Qiblah error: {e}")
        raise HTTPException(status_code=500, detail="Impossible de récupérer la direction de la Qiblah")

# ============== NEARBY MOSQUES ==============

@api_router.get("/mosques/nearby")
async def get_nearby_mosques(latitude: float, longitude: float, radius: int = 5000):
    """Get nearby mosques using Overpass API (OpenStreetMap).

    Production-grade robustness: this endpoint must never return HTTP 500
    because of an unstable external API. If Overpass times out, fails, is
    slow, returns a non-200 status, returns non-JSON (e.g. an HTML error
    page) or an empty/unexpected payload, we log it and degrade gracefully
    by returning an empty list with HTTP 200.
    """
    # Overpass API query for mosques (unchanged business logic)
    overpass_url = "https://overpass-api.de/api/interpreter"
    query = f"""
    [out:json][timeout:25];
    (
      node["amenity"="place_of_worship"]["religion"="muslim"](around:{radius},{latitude},{longitude});
      way["amenity"="place_of_worship"]["religion"="muslim"](around:{radius},{latitude},{longitude});
    );
    out center;
    """

    try:
        # 1. Network call: catch timeouts / connection errors -> []
        # Overpass / OSM usage policy requires a descriptive User-Agent; the
        # default httpx User-Agent is rejected by Overpass with HTTP 406.
        headers = {"User-Agent": "NEURA-AL-NOUR/1.0 (mosque-finder)"}
        try:
            async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
                response = await client.post(overpass_url, data={"data": query})
        except httpx.HTTPError as e:
            logger.error(f"Mosques error (Overpass request failed): {e}")
            return []

        # 2. Reject any non-200 response (e.g. 406, 429, 5xx) -> []
        if response.status_code != 200:
            logger.error(
                f"Mosques error (Overpass HTTP {response.status_code}, "
                f"content-type={response.headers.get('content-type')})"
            )
            return []

        # 3. Parse JSON defensively (Overpass may return HTML or empty body) -> []
        try:
            data = response.json()
        except ValueError as e:
            logger.error(f"Mosques error (Overpass returned non-JSON): {e}")
            return []

        # 4. Validate payload shape -> []
        if not isinstance(data, dict) or not isinstance(data.get("elements"), list):
            logger.error("Mosques error (unexpected Overpass payload shape)")
            return []

        mosques = []
        for element in data.get("elements", []):
            lat = element.get("lat") or element.get("center", {}).get("lat")
            lon = element.get("lon") or element.get("center", {}).get("lon")

            if lat and lon:
                # Calculate distance
                import math
                R = 6371000  # Earth radius in meters
                lat1, lon1 = math.radians(latitude), math.radians(longitude)
                lat2, lon2 = math.radians(lat), math.radians(lon)
                dlat = lat2 - lat1
                dlon = lon2 - lon1
                a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
                c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
                distance = R * c

                tags = element.get("tags", {})
                mosques.append({
                    "id": element.get("id"),
                    "name": tags.get("name", "Mosquée"),
                    "latitude": lat,
                    "longitude": lon,
                    "distance": round(distance),
                    "address": tags.get("addr:street", ""),
                    "city": tags.get("addr:city", "")
                })

        # Sort by distance
        mosques.sort(key=lambda x: x["distance"])
        return mosques[:20]  # Return max 20 mosques

    except Exception as e:
        # Final safety net: never propagate a 500 to the client
        logger.error(f"Mosques error (unexpected): {e}")
        return []

# ============== LEARN ISLAM ==============

ISLAM_LESSONS = [
    {
        "id": "pillars",
        "title": "Les 5 Piliers de l'Islam",
        "arabic": "أركان الإسلام الخمسة",
        "category": "bases",
        "order": 1,
        "content": [
            {
                "subtitle": "1. La Shahada (Témoignage de foi)",
                "text": "أشهد أن لا إله إلا الله وأشهد أن محمداً رسول الله",
                "translation": "Je témoigne qu'il n'y a de divinité qu'Allah et que Muhammad est Son messager.",
                "details": "C'est la déclaration de foi qui fait entrer une personne dans l'Islam. Elle affirme l'unicité d'Allah et la prophétie de Muhammad ﷺ."
            },
            {
                "subtitle": "2. La Salat (Prière)",
                "text": "Les musulmans doivent accomplir 5 prières obligatoires chaque jour : Fajr (aube), Dhuhr (midi), Asr (après-midi), Maghrib (coucher du soleil) et Isha (nuit).",
                "details": "La prière est le lien direct entre le serviteur et son Seigneur. Elle purifie l'âme et rappelle Allah tout au long de la journée."
            },
            {
                "subtitle": "3. La Zakat (Aumône obligatoire)",
                "text": "Chaque musulman possédant un certain seuil de richesse doit donner 2,5% de ses économies aux pauvres et nécessiteux.",
                "details": "La Zakat purifie la richesse et aide à réduire les inégalités dans la société musulmane."
            },
            {
                "subtitle": "4. Le Sawm (Jeûne du Ramadan)",
                "text": "Pendant le mois de Ramadan, les musulmans jeûnent de l'aube au coucher du soleil, s'abstenant de manger, boire et autres plaisirs.",
                "details": "Le jeûne développe la piété, la patience et la compassion envers les pauvres."
            },
            {
                "subtitle": "5. Le Hajj (Pèlerinage à La Mecque)",
                "text": "Tout musulman qui en a les moyens physiques et financiers doit accomplir le pèlerinage à La Mecque au moins une fois dans sa vie.",
                "details": "Le Hajj rassemble des millions de musulmans du monde entier dans l'adoration d'Allah."
            }
        ]
    },
    {
        "id": "wudu",
        "title": "Comment faire les ablutions (Wudu)",
        "arabic": "كيفية الوضوء",
        "category": "priere",
        "order": 2,
        "content": [
            {
                "subtitle": "1. L'intention (Niyyah)",
                "text": "Formulez l'intention dans votre cœur de faire les ablutions pour la prière.",
                "details": "L'intention est un acte du cœur, pas besoin de la prononcer à voix haute."
            },
            {
                "subtitle": "2. Dire Bismillah",
                "text": "بِسْمِ اللَّهِ",
                "translation": "Au nom d'Allah",
                "details": "Commencez en mentionnant le nom d'Allah."
            },
            {
                "subtitle": "3. Laver les mains",
                "text": "Lavez vos deux mains trois fois jusqu'aux poignets.",
                "details": "Assurez-vous que l'eau passe entre les doigts."
            },
            {
                "subtitle": "4. Rincer la bouche",
                "text": "Prenez de l'eau dans votre main droite, rincez votre bouche trois fois.",
                "details": "Faites circuler l'eau dans toute la bouche."
            },
            {
                "subtitle": "5. Rincer le nez",
                "text": "Aspirez de l'eau dans le nez avec la main droite et expulsez-la avec la main gauche, trois fois.",
                "details": "Ne pas aspirer trop fort pour éviter l'inconfort."
            },
            {
                "subtitle": "6. Laver le visage",
                "text": "Lavez tout le visage trois fois, du haut du front jusqu'au menton, et d'une oreille à l'autre.",
                "details": "Assurez-vous que l'eau atteint toutes les parties du visage."
            },
            {
                "subtitle": "7. Laver les bras",
                "text": "Lavez le bras droit puis le bras gauche, trois fois chacun, des doigts jusqu'aux coudes inclus.",
                "details": "Commencez toujours par le côté droit."
            },
            {
                "subtitle": "8. Essuyer la tête",
                "text": "Passez vos mains mouillées sur toute la tête, de l'avant vers l'arrière puis de l'arrière vers l'avant.",
                "details": "Une seule fois suffit."
            },
            {
                "subtitle": "9. Essuyer les oreilles",
                "text": "Essuyez l'intérieur des oreilles avec les index et l'extérieur avec les pouces.",
                "details": "Utilisez l'eau restante sur vos mains."
            },
            {
                "subtitle": "10. Laver les pieds",
                "text": "Lavez le pied droit puis le pied gauche trois fois chacun, jusqu'aux chevilles incluses.",
                "details": "Passez les doigts entre les orteils."
            }
        ]
    },
    {
        "id": "prayer",
        "title": "Comment faire la prière",
        "arabic": "كيفية الصلاة",
        "category": "priere",
        "order": 3,
        "content": [
            {
                "subtitle": "1. Se tenir debout face à la Qiblah",
                "text": "Tenez-vous debout, face à la direction de la Kaaba à La Mecque.",
                "details": "Utilisez une boussole ou l'application pour trouver la direction."
            },
            {
                "subtitle": "2. L'intention",
                "text": "Formulez l'intention dans votre cœur pour la prière que vous allez accomplir.",
                "details": "Par exemple : 'Je fais la prière du Fajr, 2 rakaat, pour Allah.'"
            },
            {
                "subtitle": "3. Takbir al-Ihram",
                "text": "اللَّهُ أَكْبَرُ",
                "translation": "Allah est le Plus Grand",
                "details": "Levez les mains jusqu'aux oreilles et prononcez le takbir."
            },
            {
                "subtitle": "4. Position debout (Qiyam)",
                "text": "Placez vos mains sur la poitrine (main droite sur la gauche) et récitez la Fatiha.",
                "details": "La Fatiha est obligatoire dans chaque rakaat."
            },
            {
                "subtitle": "5. L'inclinaison (Ruku)",
                "text": "سُبْحَانَ رَبِّيَ الْعَظِيمِ",
                "translation": "Gloire à mon Seigneur le Très Grand (3 fois)",
                "details": "Inclinez-vous en gardant le dos droit, mains sur les genoux."
            },
            {
                "subtitle": "6. Se relever du Ruku",
                "text": "سَمِعَ اللَّهُ لِمَنْ حَمِدَهُ - رَبَّنَا وَلَكَ الْحَمْدُ",
                "translation": "Allah entend celui qui Le loue - Notre Seigneur, à Toi la louange",
                "details": "Redressez-vous complètement."
            },
            {
                "subtitle": "7. La prosternation (Sujud)",
                "text": "سُبْحَانَ رَبِّيَ الأَعْلَى",
                "translation": "Gloire à mon Seigneur le Très Haut (3 fois)",
                "details": "Posez le front, le nez, les deux mains, les genoux et les orteils au sol."
            },
            {
                "subtitle": "8. S'asseoir entre les deux prosternations",
                "text": "رَبِّ اغْفِرْ لِي",
                "translation": "Seigneur, pardonne-moi",
                "details": "Asseyez-vous brièvement avant la seconde prosternation."
            },
            {
                "subtitle": "9. Le Tashahhud",
                "text": "Après deux rakaat, asseyez-vous et récitez le Tashahhud.",
                "details": "C'est la position assise où l'on témoigne de la foi."
            },
            {
                "subtitle": "10. Les Salutations finales",
                "text": "السَّلاَمُ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ",
                "translation": "Que la paix et la miséricorde d'Allah soient sur vous",
                "details": "Tournez la tête à droite puis à gauche en prononçant le salam."
            }
        ]
    },
    {
        "id": "surahs_learn",
        "title": "Sourates à apprendre",
        "arabic": "سور للحفظ",
        "category": "coran",
        "order": 4,
        "content": [
            {
                "subtitle": "Sourate Al-Fatiha (L'Ouverture)",
                "text": "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ۝ الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ ۝ الرَّحْمَٰنِ الرَّحِيمِ ۝ مَالِكِ يَوْمِ الدِّينِ ۝ إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ ۝ اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ ۝ صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ",
                "translation": "Au nom d'Allah, le Tout Miséricordieux, le Très Miséricordieux. Louange à Allah, Seigneur des mondes. Le Tout Miséricordieux, le Très Miséricordieux. Maître du Jour de la Rétribution. C'est Toi que nous adorons et c'est Toi dont nous implorons le secours. Guide-nous dans le droit chemin. Le chemin de ceux que Tu as comblés de bienfaits, non pas de ceux qui ont encouru Ta colère, ni des égarés.",
                "details": "Sourate obligatoire dans chaque rakaat de la prière."
            },
            {
                "subtitle": "Sourate Al-Ikhlas (Le Monothéisme Pur)",
                "text": "قُلْ هُوَ اللَّهُ أَحَدٌ ۝ اللَّهُ الصَّمَدُ ۝ لَمْ يَلِدْ وَلَمْ يُولَدْ ۝ وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ",
                "translation": "Dis : Il est Allah, Unique. Allah, Le Seul à être imploré pour ce que nous désirons. Il n'a jamais engendré, n'a pas été engendré non plus. Et nul n'est égal à Lui.",
                "details": "Équivaut à un tiers du Coran en récompense."
            },
            {
                "subtitle": "Sourate Al-Falaq (L'Aube Naissante)",
                "text": "قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ ۝ مِن شَرِّ مَا خَلَقَ ۝ وَمِن شَرِّ غَاسِقٍ إِذَا وَقَبَ ۝ وَمِن شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ ۝ وَمِن شَرِّ حَاسِدٍ إِذَا حَسَدَ",
                "translation": "Dis : Je cherche protection auprès du Seigneur de l'aube naissante. Contre le mal de ce qu'Il a créé. Contre le mal de l'obscurité quand elle s'approfondit. Contre le mal de celles qui soufflent sur les nœuds. Et contre le mal de l'envieux quand il envie.",
                "details": "Sourate de protection."
            },
            {
                "subtitle": "Sourate An-Nas (Les Hommes)",
                "text": "قُلْ أَعُوذُ بِرَبِّ النَّاسِ ۝ مَلِكِ النَّاسِ ۝ إِلَٰهِ النَّاسِ ۝ مِن شَرِّ الْوَسْوَاسِ الْخَنَّاسِ ۝ الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ ۝ مِنَ الْجِنَّةِ وَالنَّاسِ",
                "translation": "Dis : Je cherche protection auprès du Seigneur des hommes. Le Souverain des hommes. Le Dieu des hommes. Contre le mal du mauvais conseiller, furtif. Qui souffle le mal dans les poitrines des hommes. Qu'il soit djinn ou homme.",
                "details": "Sourate de protection contre le mal."
            },
            {
                "subtitle": "Ayat Al-Kursi (Le Verset du Trône)",
                "text": "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَّهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ ۗ مَن ذَا الَّذِي يَشْفَعُ عِندَهُ إِلَّا بِإِذْنِهِ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَيْءٍ مِّنْ عِلْمِهِ إِلَّا بِمَا شَاءَ ۚ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ ۖ وَلَا يَئُودُهُ حِفْظُهُمَا ۚ وَهُوَ الْعَلِيُّ الْعَظِيمُ",
                "translation": "Allah ! Point de divinité à part Lui, le Vivant, Celui qui subsiste par lui-même. Ni somnolence ni sommeil ne Le saisissent. À Lui appartient tout ce qui est dans les cieux et sur la terre...",
                "details": "Le plus grand verset du Coran. Récitez-le avant de dormir pour la protection."
            }
        ]
    },
    {
        "id": "invocations",
        "title": "Invocations importantes",
        "arabic": "أذكار مهمة",
        "category": "douas",
        "order": 5,
        "content": [
            {
                "subtitle": "Au réveil",
                "text": "الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ",
                "translation": "Louange à Allah qui nous a rendu la vie après nous avoir fait mourir, et c'est vers Lui la résurrection."
            },
            {
                "subtitle": "Avant de manger",
                "text": "بِسْمِ اللَّهِ",
                "translation": "Au nom d'Allah."
            },
            {
                "subtitle": "Après avoir mangé",
                "text": "الْحَمْدُ لِلَّهِ الَّذِي أَطْعَمَنِي هَذَا وَرَزَقَنِيهِ مِنْ غَيْرِ حَوْلٍ مِنِّي وَلَا قُوَّةٍ",
                "translation": "Louange à Allah qui m'a nourri de ceci et me l'a accordé sans effort ni force de ma part."
            },
            {
                "subtitle": "En entrant aux toilettes",
                "text": "اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْخُبُثِ وَالْخَبَائِثِ",
                "translation": "Ô Allah, je cherche refuge auprès de Toi contre les démons mâles et femelles."
            },
            {
                "subtitle": "En sortant des toilettes",
                "text": "غُفْرَانَكَ",
                "translation": "Je Te demande pardon."
            },
            {
                "subtitle": "En entrant à la maison",
                "text": "بِسْمِ اللَّهِ وَلَجْنَا وَبِسْمِ اللَّهِ خَرَجْنَا وَعَلَى اللَّهِ رَبِّنَا تَوَكَّلْنَا",
                "translation": "Au nom d'Allah nous entrons, au nom d'Allah nous sortons, et en Allah notre Seigneur nous plaçons notre confiance."
            },
            {
                "subtitle": "En sortant de la maison",
                "text": "بِسْمِ اللَّهِ تَوَكَّلْتُ عَلَى اللَّهِ وَلَا حَوْلَ وَلَا قُوَّةَ إِلَّا بِاللَّهِ",
                "translation": "Au nom d'Allah, je place ma confiance en Allah. Il n'y a de force et de puissance qu'en Allah."
            },
            {
                "subtitle": "Avant de dormir",
                "text": "بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا",
                "translation": "C'est en Ton nom, ô Allah, que je meurs et que je vis."
            }
        ]
    }
]

@api_router.get("/learn/lessons")
async def get_lessons():
    """Get all learning lessons"""
    return ISLAM_LESSONS

@api_router.get("/learn/lessons/{lesson_id}")
async def get_lesson(lesson_id: str):
    """Get a specific lesson"""
    lesson = next((l for l in ISLAM_LESSONS if l["id"] == lesson_id), None)
    if not lesson:
        raise HTTPException(status_code=404, detail="Leçon non trouvée")
    return lesson

@api_router.get("/learn/progress")
async def get_learn_progress(user: dict = Depends(get_current_user)):
    """Get user's learning progress"""
    progress = await db.learn_progress.find_one(
        {"user_id": user["id"]},
        {"_id": 0}
    )
    if not progress:
        progress = {
            "user_id": user["id"],
            "completed_lessons": [],
            "current_lesson": None,
            "last_position": {}
        }
    return progress

@api_router.post("/learn/progress")
async def update_learn_progress(
    lesson_id: str,
    section_index: int = 0,
    completed: bool = False,
    user: dict = Depends(get_current_user)
):
    """Update user's learning progress"""
    progress = await db.learn_progress.find_one({"user_id": user["id"]})
    
    if not progress:
        progress = {
            "user_id": user["id"],
            "completed_lessons": [],
            "current_lesson": lesson_id,
            "last_position": {lesson_id: section_index}
        }
    else:
        progress["current_lesson"] = lesson_id
        progress["last_position"] = progress.get("last_position", {})
        progress["last_position"][lesson_id] = section_index
        
        if completed and lesson_id not in progress.get("completed_lessons", []):
            progress["completed_lessons"] = progress.get("completed_lessons", []) + [lesson_id]
    
    await db.learn_progress.update_one(
        {"user_id": user["id"]},
        {"$set": progress},
        upsert=True
    )
    
    return {"success": True, "progress": progress}

# ============== QURAN ==============

QURAN_SURAHS = [
    {"number": 1, "name": "الفاتحة", "englishName": "Al-Fatiha", "frenchName": "L'Ouverture", "ayahs": 7},
    {"number": 2, "name": "البقرة", "englishName": "Al-Baqara", "frenchName": "La Vache", "ayahs": 286},
    {"number": 3, "name": "آل عمران", "englishName": "Aal-Imran", "frenchName": "La Famille d'Imran", "ayahs": 200},
    {"number": 4, "name": "النساء", "englishName": "An-Nisa", "frenchName": "Les Femmes", "ayahs": 176},
    {"number": 5, "name": "المائدة", "englishName": "Al-Maida", "frenchName": "La Table Servie", "ayahs": 120},
    {"number": 6, "name": "الأنعام", "englishName": "Al-Anam", "frenchName": "Les Bestiaux", "ayahs": 165},
    {"number": 7, "name": "الأعراف", "englishName": "Al-Araf", "frenchName": "Les Murailles", "ayahs": 206},
    {"number": 8, "name": "الأنفال", "englishName": "Al-Anfal", "frenchName": "Le Butin", "ayahs": 75},
    {"number": 9, "name": "التوبة", "englishName": "At-Tawba", "frenchName": "Le Repentir", "ayahs": 129},
    {"number": 10, "name": "يونس", "englishName": "Yunus", "frenchName": "Jonas", "ayahs": 109},
    {"number": 11, "name": "هود", "englishName": "Hud", "frenchName": "Houd", "ayahs": 123},
    {"number": 12, "name": "يوسف", "englishName": "Yusuf", "frenchName": "Joseph", "ayahs": 111},
    {"number": 13, "name": "الرعد", "englishName": "Ar-Rad", "frenchName": "Le Tonnerre", "ayahs": 43},
    {"number": 14, "name": "ابراهيم", "englishName": "Ibrahim", "frenchName": "Abraham", "ayahs": 52},
    {"number": 15, "name": "الحجر", "englishName": "Al-Hijr", "frenchName": "Al-Hijr", "ayahs": 99},
    {"number": 16, "name": "النحل", "englishName": "An-Nahl", "frenchName": "Les Abeilles", "ayahs": 128},
    {"number": 17, "name": "الإسراء", "englishName": "Al-Isra", "frenchName": "Le Voyage Nocturne", "ayahs": 111},
    {"number": 18, "name": "الكهف", "englishName": "Al-Kahf", "frenchName": "La Caverne", "ayahs": 110},
    {"number": 19, "name": "مريم", "englishName": "Maryam", "frenchName": "Marie", "ayahs": 98},
    {"number": 20, "name": "طه", "englishName": "Ta-Ha", "frenchName": "Ta-Ha", "ayahs": 135},
    {"number": 21, "name": "الأنبياء", "englishName": "Al-Anbiya", "frenchName": "Les Prophètes", "ayahs": 112},
    {"number": 22, "name": "الحج", "englishName": "Al-Hajj", "frenchName": "Le Pèlerinage", "ayahs": 78},
    {"number": 23, "name": "المؤمنون", "englishName": "Al-Muminun", "frenchName": "Les Croyants", "ayahs": 118},
    {"number": 24, "name": "النور", "englishName": "An-Nur", "frenchName": "La Lumière", "ayahs": 64},
    {"number": 25, "name": "الفرقان", "englishName": "Al-Furqan", "frenchName": "Le Discernement", "ayahs": 77},
    {"number": 26, "name": "الشعراء", "englishName": "Ash-Shuara", "frenchName": "Les Poètes", "ayahs": 227},
    {"number": 27, "name": "النمل", "englishName": "An-Naml", "frenchName": "Les Fourmis", "ayahs": 93},
    {"number": 28, "name": "القصص", "englishName": "Al-Qasas", "frenchName": "Le Récit", "ayahs": 88},
    {"number": 29, "name": "العنكبوت", "englishName": "Al-Ankabut", "frenchName": "L'Araignée", "ayahs": 69},
    {"number": 30, "name": "الروم", "englishName": "Ar-Rum", "frenchName": "Les Romains", "ayahs": 60},
    {"number": 31, "name": "لقمان", "englishName": "Luqman", "frenchName": "Luqman", "ayahs": 34},
    {"number": 32, "name": "السجدة", "englishName": "As-Sajda", "frenchName": "La Prosternation", "ayahs": 30},
    {"number": 33, "name": "الأحزاب", "englishName": "Al-Ahzab", "frenchName": "Les Coalisés", "ayahs": 73},
    {"number": 34, "name": "سبأ", "englishName": "Saba", "frenchName": "Saba", "ayahs": 54},
    {"number": 35, "name": "فاطر", "englishName": "Fatir", "frenchName": "Le Créateur", "ayahs": 45},
    {"number": 36, "name": "يس", "englishName": "Ya-Sin", "frenchName": "Ya-Sin", "ayahs": 83},
    {"number": 37, "name": "الصافات", "englishName": "As-Saffat", "frenchName": "Les Rangés", "ayahs": 182},
    {"number": 38, "name": "ص", "englishName": "Sad", "frenchName": "Sad", "ayahs": 88},
    {"number": 39, "name": "الزمر", "englishName": "Az-Zumar", "frenchName": "Les Groupes", "ayahs": 75},
    {"number": 40, "name": "غافر", "englishName": "Ghafir", "frenchName": "Le Pardonneur", "ayahs": 85},
    {"number": 41, "name": "فصلت", "englishName": "Fussilat", "frenchName": "Les Versets Détaillés", "ayahs": 54},
    {"number": 42, "name": "الشورى", "englishName": "Ash-Shura", "frenchName": "La Consultation", "ayahs": 53},
    {"number": 43, "name": "الزخرف", "englishName": "Az-Zukhruf", "frenchName": "L'Ornement", "ayahs": 89},
    {"number": 44, "name": "الدخان", "englishName": "Ad-Dukhan", "frenchName": "La Fumée", "ayahs": 59},
    {"number": 45, "name": "الجاثية", "englishName": "Al-Jathiya", "frenchName": "L'Agenouillée", "ayahs": 37},
    {"number": 46, "name": "الأحقاف", "englishName": "Al-Ahqaf", "frenchName": "Al-Ahqaf", "ayahs": 35},
    {"number": 47, "name": "محمد", "englishName": "Muhammad", "frenchName": "Muhammad", "ayahs": 38},
    {"number": 48, "name": "الفتح", "englishName": "Al-Fath", "frenchName": "La Victoire Éclatante", "ayahs": 29},
    {"number": 49, "name": "الحجرات", "englishName": "Al-Hujurat", "frenchName": "Les Appartements", "ayahs": 18},
    {"number": 50, "name": "ق", "englishName": "Qaf", "frenchName": "Qaf", "ayahs": 45},
    {"number": 51, "name": "الذاريات", "englishName": "Adh-Dhariyat", "frenchName": "Qui Éparpillent", "ayahs": 60},
    {"number": 52, "name": "الطور", "englishName": "At-Tur", "frenchName": "Le Mont", "ayahs": 49},
    {"number": 53, "name": "النجم", "englishName": "An-Najm", "frenchName": "L'Étoile", "ayahs": 62},
    {"number": 54, "name": "القمر", "englishName": "Al-Qamar", "frenchName": "La Lune", "ayahs": 55},
    {"number": 55, "name": "الرحمن", "englishName": "Ar-Rahman", "frenchName": "Le Tout Miséricordieux", "ayahs": 78},
    {"number": 56, "name": "الواقعة", "englishName": "Al-Waqia", "frenchName": "L'Événement", "ayahs": 96},
    {"number": 57, "name": "الحديد", "englishName": "Al-Hadid", "frenchName": "Le Fer", "ayahs": 29},
    {"number": 58, "name": "المجادلة", "englishName": "Al-Mujadila", "frenchName": "La Discussion", "ayahs": 22},
    {"number": 59, "name": "الحشر", "englishName": "Al-Hashr", "frenchName": "L'Exode", "ayahs": 24},
    {"number": 60, "name": "الممتحنة", "englishName": "Al-Mumtahana", "frenchName": "L'Éprouvée", "ayahs": 13},
    {"number": 61, "name": "الصف", "englishName": "As-Saff", "frenchName": "Le Rang", "ayahs": 14},
    {"number": 62, "name": "الجمعة", "englishName": "Al-Jumua", "frenchName": "Le Vendredi", "ayahs": 11},
    {"number": 63, "name": "المنافقون", "englishName": "Al-Munafiqun", "frenchName": "Les Hypocrites", "ayahs": 11},
    {"number": 64, "name": "التغابن", "englishName": "At-Taghabun", "frenchName": "La Grande Perte", "ayahs": 18},
    {"number": 65, "name": "الطلاق", "englishName": "At-Talaq", "frenchName": "Le Divorce", "ayahs": 12},
    {"number": 66, "name": "التحريم", "englishName": "At-Tahrim", "frenchName": "L'Interdiction", "ayahs": 12},
    {"number": 67, "name": "الملك", "englishName": "Al-Mulk", "frenchName": "La Royauté", "ayahs": 30},
    {"number": 68, "name": "القلم", "englishName": "Al-Qalam", "frenchName": "La Plume", "ayahs": 52},
    {"number": 69, "name": "الحاقة", "englishName": "Al-Haqqa", "frenchName": "Celle Qui Montre la Vérité", "ayahs": 52},
    {"number": 70, "name": "المعارج", "englishName": "Al-Maarij", "frenchName": "Les Voies d'Ascension", "ayahs": 44},
    {"number": 71, "name": "نوح", "englishName": "Nuh", "frenchName": "Noé", "ayahs": 28},
    {"number": 72, "name": "الجن", "englishName": "Al-Jinn", "frenchName": "Les Djinns", "ayahs": 28},
    {"number": 73, "name": "المزمل", "englishName": "Al-Muzzammil", "frenchName": "L'Enveloppé", "ayahs": 20},
    {"number": 74, "name": "المدثر", "englishName": "Al-Muddaththir", "frenchName": "Le Revêtu d'un Manteau", "ayahs": 56},
    {"number": 75, "name": "القيامة", "englishName": "Al-Qiyama", "frenchName": "La Résurrection", "ayahs": 40},
    {"number": 76, "name": "الإنسان", "englishName": "Al-Insan", "frenchName": "L'Homme", "ayahs": 31},
    {"number": 77, "name": "المرسلات", "englishName": "Al-Mursalat", "frenchName": "Les Envoyés", "ayahs": 50},
    {"number": 78, "name": "النبإ", "englishName": "An-Naba", "frenchName": "La Nouvelle", "ayahs": 40},
    {"number": 79, "name": "النازعات", "englishName": "An-Naziat", "frenchName": "Les Anges Qui Arrachent", "ayahs": 46},
    {"number": 80, "name": "عبس", "englishName": "Abasa", "frenchName": "Il S'est Renfrogné", "ayahs": 42},
    {"number": 81, "name": "التكوير", "englishName": "At-Takwir", "frenchName": "L'Obscurcissement", "ayahs": 29},
    {"number": 82, "name": "الإنفطار", "englishName": "Al-Infitar", "frenchName": "La Rupture", "ayahs": 19},
    {"number": 83, "name": "المطففين", "englishName": "Al-Mutaffifin", "frenchName": "Les Fraudeurs", "ayahs": 36},
    {"number": 84, "name": "الإنشقاق", "englishName": "Al-Inshiqaq", "frenchName": "La Déchirure", "ayahs": 25},
    {"number": 85, "name": "البروج", "englishName": "Al-Buruj", "frenchName": "Les Constellations", "ayahs": 22},
    {"number": 86, "name": "الطارق", "englishName": "At-Tariq", "frenchName": "L'Astre Nocturne", "ayahs": 17},
    {"number": 87, "name": "الأعلى", "englishName": "Al-Ala", "frenchName": "Le Très-Haut", "ayahs": 19},
    {"number": 88, "name": "الغاشية", "englishName": "Al-Ghashiya", "frenchName": "L'Enveloppante", "ayahs": 26},
    {"number": 89, "name": "الفجر", "englishName": "Al-Fajr", "frenchName": "L'Aube", "ayahs": 30},
    {"number": 90, "name": "البلد", "englishName": "Al-Balad", "frenchName": "La Cité", "ayahs": 20},
    {"number": 91, "name": "الشمس", "englishName": "Ash-Shams", "frenchName": "Le Soleil", "ayahs": 15},
    {"number": 92, "name": "الليل", "englishName": "Al-Layl", "frenchName": "La Nuit", "ayahs": 21},
    {"number": 93, "name": "الضحى", "englishName": "Ad-Duha", "frenchName": "Le Jour Montant", "ayahs": 11},
    {"number": 94, "name": "الشرح", "englishName": "Ash-Sharh", "frenchName": "L'Ouverture de la Poitrine", "ayahs": 8},
    {"number": 95, "name": "التين", "englishName": "At-Tin", "frenchName": "Le Figuier", "ayahs": 8},
    {"number": 96, "name": "العلق", "englishName": "Al-Alaq", "frenchName": "L'Adhérence", "ayahs": 19},
    {"number": 97, "name": "القدر", "englishName": "Al-Qadr", "frenchName": "La Destinée", "ayahs": 5},
    {"number": 98, "name": "البينة", "englishName": "Al-Bayyina", "frenchName": "La Preuve", "ayahs": 8},
    {"number": 99, "name": "الزلزلة", "englishName": "Az-Zalzala", "frenchName": "La Secousse", "ayahs": 8},
    {"number": 100, "name": "العاديات", "englishName": "Al-Adiyat", "frenchName": "Les Coursiers", "ayahs": 11},
    {"number": 101, "name": "القارعة", "englishName": "Al-Qaria", "frenchName": "Le Fracas", "ayahs": 11},
    {"number": 102, "name": "التكاثر", "englishName": "At-Takathur", "frenchName": "La Course aux Richesses", "ayahs": 8},
    {"number": 103, "name": "العصر", "englishName": "Al-Asr", "frenchName": "Le Temps", "ayahs": 3},
    {"number": 104, "name": "الهمزة", "englishName": "Al-Humaza", "frenchName": "Les Calomniateurs", "ayahs": 9},
    {"number": 105, "name": "الفيل", "englishName": "Al-Fil", "frenchName": "L'Éléphant", "ayahs": 5},
    {"number": 106, "name": "قريش", "englishName": "Quraysh", "frenchName": "Quraysh", "ayahs": 4},
    {"number": 107, "name": "الماعون", "englishName": "Al-Maun", "frenchName": "L'Ustensile", "ayahs": 7},
    {"number": 108, "name": "الكوثر", "englishName": "Al-Kawthar", "frenchName": "L'Abondance", "ayahs": 3},
    {"number": 109, "name": "الكافرون", "englishName": "Al-Kafirun", "frenchName": "Les Infidèles", "ayahs": 6},
    {"number": 110, "name": "النصر", "englishName": "An-Nasr", "frenchName": "Le Secours", "ayahs": 3},
    {"number": 111, "name": "المسد", "englishName": "Al-Masad", "frenchName": "Les Fibres", "ayahs": 5},
    {"number": 112, "name": "الإخلاص", "englishName": "Al-Ikhlas", "frenchName": "Le Monothéisme Pur", "ayahs": 4},
    {"number": 113, "name": "الفلق", "englishName": "Al-Falaq", "frenchName": "L'Aube Naissante", "ayahs": 5},
    {"number": 114, "name": "الناس", "englishName": "An-Nas", "frenchName": "Les Hommes", "ayahs": 6}
]

@api_router.get("/quran/surahs")
async def get_surahs():
    """Get list of all surahs"""
    return QURAN_SURAHS

@api_router.get("/quran/surah/{surah_number}")
async def get_surah(surah_number: int):
    """Get a specific surah with Arabic text and French translation"""
    try:
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            # Get Arabic text
            arabic_url = f"http://api.alquran.cloud/v1/surah/{surah_number}"
            arabic_response = await http_client.get(arabic_url)
            arabic_data = arabic_response.json()
            
            # Get French translation
            french_url = f"http://api.alquran.cloud/v1/surah/{surah_number}/fr.hamidullah"
            french_response = await http_client.get(french_url)
            french_data = french_response.json()
            
            if arabic_data.get("code") == 200 and french_data.get("code") == 200:
                surah_info = arabic_data["data"]
                ayahs = []
                
                for i, ayah in enumerate(surah_info["ayahs"]):
                    ayahs.append({
                        "number": ayah["numberInSurah"],
                        "arabic": ayah["text"],
                        "french": french_data["data"]["ayahs"][i]["text"] if i < len(french_data["data"]["ayahs"]) else ""
                    })
                
                return {
                    "number": surah_info["number"],
                    "name": surah_info["name"],
                    "englishName": surah_info["englishName"],
                    "revelationType": surah_info["revelationType"],
                    "ayahs": ayahs
                }
            else:
                raise HTTPException(status_code=500, detail="Erreur API Quran")
    except Exception as e:
        logger.error(f"Quran error: {e}")
        raise HTTPException(status_code=500, detail="Impossible de récupérer la sourate")

@api_router.get("/quran/audio/{surah_number}")
async def get_surah_audio(surah_number: int, reciter: str = "mishary_rashid_alafasy"):
    """Get audio URL for a surah - using EveryAyah"""
    # Format surah number with leading zeros
    surah_str = str(surah_number).zfill(3)
    
    # Mishary Rashid Alafasy audio from EveryAyah
    base_url = "https://everyayah.com/data/Alafasy_128kbps"
    
    return {
        "surah": surah_number,
        "reciter": "Mishary Rashid Alafasy",
        "base_url": base_url,
        "format": f"{base_url}/{surah_str}XXX.mp3",
        "note": "Replace XXX with ayah number (e.g., 001001.mp3 for Surah 1, Ayah 1)"
    }


# ============== AUTHENTIC MUSHAF READER (text only, no AI) ==============

MUSHAF_SOURCE = "AlQuran Cloud / Islamic Network"
MUSHAF_ARABIC_EDITION = "quran-uthmani"
MUSHAF_TRANSLATIONS = {
    "fr": {
        "edition": "fr.hamidullah",
        "name": "Le Saint Coran",
        "translator": "Muhammad Hamidullah",
        "language": "Français",
    }
}


async def _fetch_mushaf_source(http_client: httpx.AsyncClient, path: str) -> dict:
    """Fetch immutable source text. Never repairs, rewrites or substitutes content."""
    response = await http_client.get(f"https://api.alquran.cloud/v1/{path}")
    if response.status_code != 200 or not response.content:
        raise RuntimeError(f"Mushaf source unavailable ({response.status_code})")
    try:
        payload = json.loads(response.content.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError("Mushaf source returned invalid UTF-8 JSON") from exc
    if payload.get("code") != 200 or not isinstance(payload.get("data"), dict):
        raise RuntimeError("Mushaf source returned an invalid payload")
    return payload["data"]


@api_router.get("/mushaf/config")
async def get_mushaf_config():
    return {
        "source": MUSHAF_SOURCE,
        "arabicEdition": MUSHAF_ARABIC_EDITION,
        "translations": MUSHAF_TRANSLATIONS,
        "pages": 604,
        "aiGenerated": False,
        "audioModified": False,
    }


@api_router.get("/mushaf/page/{page_number}")
async def get_mushaf_page(page_number: int, translation: str = "fr"):
    if page_number < 1 or page_number > 604:
        raise HTTPException(status_code=400, detail="La page doit être comprise entre 1 et 604")
    translation_info = MUSHAF_TRANSLATIONS.get(translation)
    if not translation_info:
        raise HTTPException(status_code=400, detail="Traduction authentifiée non disponible")

    try:
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            arabic_data, translated_data = await asyncio.gather(
                _fetch_mushaf_source(
                    http_client, f"page/{page_number}/{MUSHAF_ARABIC_EDITION}"
                ),
                _fetch_mushaf_source(
                    http_client, f"page/{page_number}/{translation_info['edition']}"
                ),
            )

        if arabic_data.get("edition", {}).get("identifier") != MUSHAF_ARABIC_EDITION:
            raise RuntimeError("Unexpected Arabic edition")
        if translated_data.get("edition", {}).get("identifier") != translation_info["edition"]:
            raise RuntimeError("Unexpected translation edition")

        arabic_ayahs = arabic_data.get("ayahs") or []
        translated_ayahs = translated_data.get("ayahs") or []
        arabic_numbers = [ayah.get("number") for ayah in arabic_ayahs]
        translated_numbers = [ayah.get("number") for ayah in translated_ayahs]
        if not arabic_ayahs or arabic_numbers != translated_numbers:
            raise RuntimeError("Arabic and translation ayahs are not aligned")

        ayahs = []
        for arabic, translated in zip(arabic_ayahs, translated_ayahs):
            arabic_text = arabic.get("text")
            translated_text = translated.get("text")
            if not isinstance(arabic_text, str) or not arabic_text:
                raise RuntimeError("Missing Arabic source text")
            if not isinstance(translated_text, str) or not translated_text:
                raise RuntimeError("Missing authenticated translation text")
            ayahs.append({
                "number": arabic.get("number"),
                "numberInSurah": arabic.get("numberInSurah"),
                "surah": arabic.get("surah"),
                "juz": arabic.get("juz"),
                "manzil": arabic.get("manzil"),
                "page": arabic.get("page"),
                "ruku": arabic.get("ruku"),
                "hizbQuarter": arabic.get("hizbQuarter"),
                "sajda": arabic.get("sajda"),
                "arabic": arabic_text,
                "translation": translated_text,
            })

        return {
            "page": page_number,
            "totalPages": 604,
            "source": MUSHAF_SOURCE,
            "arabicEdition": MUSHAF_ARABIC_EDITION,
            "translation": translation_info,
            "ayahs": ayahs,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Mushaf page source error: %s", str(exc)[:200])
        raise HTTPException(
            status_code=503,
            detail="Le contenu authentifié n'a pas pu être chargé. Aucun texte de remplacement n'est affiché.",
        )


@api_router.get("/mushaf/surahs")
async def get_mushaf_surahs():
    try:
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            response = await http_client.get("https://api.alquran.cloud/v1/surah")
        payload = json.loads(response.content.decode("utf-8-sig"))
        surahs = payload.get("data") if response.status_code == 200 else None
        if payload.get("code") != 200 or not isinstance(surahs, list) or len(surahs) != 114:
            raise RuntimeError("Invalid surah index")
        required = {"number", "name", "englishName", "englishNameTranslation", "numberOfAyahs", "revelationType"}
        if any(not required.issubset(surah) for surah in surahs):
            raise RuntimeError("Incomplete surah index")
        return {"source": MUSHAF_SOURCE, "surahs": surahs}
    except Exception as exc:
        logger.error("Mushaf surah index error: %s", str(exc)[:200])
        raise HTTPException(status_code=503, detail="L'index authentifié des sourates est indisponible.")


@api_router.get("/mushaf/locate/{reference_type}/{reference}")
async def locate_mushaf_reference(reference_type: str, reference: str):
    try:
        if reference_type == "page":
            page = int(reference)
            if page < 1 or page > 604:
                raise ValueError("Invalid page")
            return {"page": page}

        if reference_type == "surah":
            number = int(reference)
            if number < 1 or number > 114:
                raise ValueError("Invalid surah")
            source_path = f"surah/{number}/{MUSHAF_ARABIC_EDITION}"
        elif reference_type == "juz":
            number = int(reference)
            if number < 1 or number > 30:
                raise ValueError("Invalid juz")
            source_path = f"juz/{number}/{MUSHAF_ARABIC_EDITION}"
        elif reference_type == "hizb":
            number = int(reference)
            if number < 1 or number > 60:
                raise ValueError("Invalid hizb")
            first_quarter = ((number - 1) * 4) + 1
            source_path = f"hizbQuarter/{first_quarter}/{MUSHAF_ARABIC_EDITION}"
        elif reference_type == "ayah":
            parts = reference.split(":")
            if len(parts) != 2:
                raise ValueError("Invalid ayah reference")
            surah_number, ayah_number = (int(part) for part in parts)
            if surah_number < 1 or surah_number > 114 or ayah_number < 1:
                raise ValueError("Invalid ayah reference")
            source_path = f"ayah/{surah_number}:{ayah_number}/{MUSHAF_ARABIC_EDITION}"
        else:
            raise ValueError("Invalid reference type")

        async with httpx.AsyncClient(timeout=30.0) as http_client:
            data = await _fetch_mushaf_source(http_client, source_path)
        if data.get("edition", {}).get("identifier") != MUSHAF_ARABIC_EDITION:
            raise RuntimeError("Unexpected Arabic edition")
        ayahs = data.get("ayahs") if isinstance(data.get("ayahs"), list) else [data]
        page = ayahs[0].get("page") if ayahs else None
        if not isinstance(page, int) or page < 1 or page > 604:
            raise RuntimeError("Missing page reference")
        return {"page": page}
    except ValueError:
        raise HTTPException(status_code=400, detail="Référence coranique invalide")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Mushaf locate error: %s", str(exc)[:200])
        raise HTTPException(status_code=503, detail="La référence authentifiée n'a pas pu être chargée.")


@api_router.get("/mushaf/search")
async def search_mushaf(q: str, edition: str = "fr"):
    query = q.strip()
    if len(query) < 2 or len(query) > 80:
        raise HTTPException(status_code=400, detail="La recherche doit contenir entre 2 et 80 caractères")
    edition_id = MUSHAF_ARABIC_EDITION if edition == "ar" else MUSHAF_TRANSLATIONS.get(edition, {}).get("edition")
    if not edition_id:
        raise HTTPException(status_code=400, detail="Édition authentifiée non disponible")

    try:
        encoded_query = quote(query, safe="")
        async with httpx.AsyncClient(timeout=30.0) as http_client:
            search_response, meta_response = await asyncio.gather(
                http_client.get(f"https://api.alquran.cloud/v1/search/{encoded_query}/all/{edition_id}"),
                http_client.get("https://api.alquran.cloud/v1/meta"),
            )
        search_payload = json.loads(search_response.content.decode("utf-8-sig"))
        meta_payload = json.loads(meta_response.content.decode("utf-8-sig"))
        if search_response.status_code == 404 and search_payload.get("code") == 404:
            matches = []
        else:
            matches = search_payload.get("data", {}).get("matches") if search_response.status_code == 200 else None
        page_references = meta_payload.get("data", {}).get("pages", {}).get("references") if meta_response.status_code == 200 else None
        if search_response.status_code not in (200, 404) or not isinstance(matches, list):
            raise RuntimeError("Invalid search payload")
        if meta_payload.get("code") != 200 or not isinstance(page_references, list) or len(page_references) != 604:
            raise RuntimeError("Invalid page metadata")

        results = []
        for match in matches[:50]:
            surah = match.get("surah") or {}
            target = (surah.get("number"), match.get("numberInSurah"))
            if not all(isinstance(value, int) for value in target):
                raise RuntimeError("Invalid search match reference")
            page = 1
            for index, page_reference in enumerate(page_references):
                start = (page_reference.get("surah"), page_reference.get("ayah"))
                if not all(isinstance(value, int) for value in start):
                    raise RuntimeError("Invalid page reference")
                if start > target:
                    break
                page = index + 1
            text = match.get("text")
            if not isinstance(text, str) or not text:
                raise RuntimeError("Missing source search text")
            results.append({
                "number": match.get("number"),
                "numberInSurah": match.get("numberInSurah"),
                "surah": surah,
                "page": page,
                "text": text,
            })
        return {
            "source": MUSHAF_SOURCE,
            "edition": edition_id,
            "query": query,
            "total": search_payload.get("data", {}).get("count", len(matches)) if isinstance(search_payload.get("data"), dict) else 0,
            "results": results,
        }
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Mushaf search error: %s", str(exc)[:200])
        raise HTTPException(status_code=503, detail="La recherche authentifiée est temporairement indisponible.")

# ============== DUAS ==============

DUAS = [
    {
        "id": "morning_1",
        "category": "morning",
        "arabic": "أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ",
        "french": "Nous voilà au matin et le royaume appartient à Allah. Louange à Allah. Il n'y a de divinité qu'Allah, Seul, sans associé.",
        "transliteration": "Asbahna wa asbahal-mulku lillah, walhamdu lillah, la ilaha illallahu wahdahu la sharika lah"
    },
    {
        "id": "morning_2",
        "category": "morning",
        "arabic": "اللَّهُمَّ بِكَ أَصْبَحْنَا، وَبِكَ أَمْسَيْنَا، وَبِكَ نَحْيَا، وَبِكَ نَمُوتُ، وَإِلَيْكَ النُّشُورُ",
        "french": "Ô Allah, c'est par Toi que nous nous retrouvons au matin et c'est par Toi que nous nous retrouvons au soir, et c'est par Toi que nous vivons et que nous mourons, et c'est vers Toi la résurrection.",
        "transliteration": "Allahumma bika asbahna wa bika amsayna wa bika nahya wa bika namutu wa ilaykan-nushur"
    },
    {
        "id": "evening_1",
        "category": "evening",
        "arabic": "أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ",
        "french": "Nous voilà au soir et le royaume appartient à Allah. Louange à Allah. Il n'y a de divinité qu'Allah, Seul, sans associé.",
        "transliteration": "Amsayna wa amsal-mulku lillah, walhamdu lillah, la ilaha illallahu wahdahu la sharika lah"
    },
    {
        "id": "sleep_1",
        "category": "sleep",
        "arabic": "بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا",
        "french": "C'est en Ton nom, ô Allah, que je meurs et que je vis.",
        "transliteration": "Bismika Allahumma amutu wa ahya"
    },
    {
        "id": "food_before",
        "category": "food",
        "arabic": "بِسْمِ اللَّهِ",
        "french": "Au nom d'Allah.",
        "transliteration": "Bismillah"
    },
    {
        "id": "food_after",
        "category": "food",
        "arabic": "الْحَمْدُ لِلَّهِ الَّذِي أَطْعَمَنِي هَذَا، وَرَزَقَنِيهِ مِنْ غَيْرِ حَوْلٍ مِنِّي وَلَا قُوَّةٍ",
        "french": "Louange à Allah qui m'a nourri de ceci et me l'a accordé sans que j'y sois pour quelque chose, ni effort, ni puissance.",
        "transliteration": "Alhamdu lillahil-ladhi at'amani hadha wa razaqanihi min ghayri hawlin minni wa la quwwah"
    },
    {
        "id": "protection_1",
        "category": "protection",
        "arabic": "أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ",
        "french": "Je cherche refuge dans les paroles parfaites d'Allah contre le mal de ce qu'Il a créé.",
        "transliteration": "A'udhu bikalimatillahit-tammati min sharri ma khalaq"
    },
    {
        "id": "travel_1",
        "category": "travel",
        "arabic": "سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ",
        "french": "Gloire à Celui qui nous a soumis cela alors que nous n'étions pas capables de le maîtriser.",
        "transliteration": "Subhanal-ladhi sakhkhara lana hadha wa ma kunna lahu muqrinin"
    },
    {
        "id": "fasting_iftar",
        "category": "ramadan",
        "arabic": "ذَهَبَ الظَّمَأُ وَابْتَلَّتِ الْعُرُوقُ، وَثَبَتَ الْأَجْرُ إِنْ شَاءَ اللَّهُ",
        "french": "La soif est partie, les veines se sont humidifiées et la récompense est confirmée si Allah le veut.",
        "transliteration": "Dhahaba adh-dhama'u wabtallat al-'uruqu wa thabata al-ajru in sha'Allah"
    },
    {
        "id": "eid_1",
        "category": "eid",
        "arabic": "تَقَبَّلَ اللَّهُ مِنَّا وَمِنْكُمْ",
        "french": "Qu'Allah accepte de nous et de vous.",
        "transliteration": "Taqabbalallahu minna wa minkum"
    }
]

@api_router.get("/duas")
async def get_duas(category: Optional[str] = None):
    """Get all duas or filter by category"""
    if category:
        return [dua for dua in DUAS if dua["category"] == category]
    return DUAS

@api_router.get("/duas/categories")
async def get_dua_categories():
    """Get all dua categories"""
    return ["morning", "evening", "sleep", "food", "protection", "travel", "ramadan", "eid"]

# ============== ISLAMIC QUIZ ==============

QUIZ_QUESTIONS = [
    {
        "id": "q1",
        "question": "Combien de piliers compte l'Islam ?",
        "options": ["3", "4", "5", "6"],
        "correct_answer": 2,
        "category": "piliers"
    },
    {
        "id": "q2",
        "question": "Quel est le premier pilier de l'Islam ?",
        "options": ["La prière", "Le jeûne", "La Shahada (témoignage de foi)", "La Zakat"],
        "correct_answer": 2,
        "category": "piliers"
    },
    {
        "id": "q3",
        "question": "Combien de sourates contient le Coran ?",
        "options": ["100", "114", "120", "99"],
        "correct_answer": 1,
        "category": "coran"
    },
    {
        "id": "q4",
        "question": "Quelle est la première sourate du Coran ?",
        "options": ["Al-Baqara", "Al-Ikhlas", "Al-Fatiha", "An-Nas"],
        "correct_answer": 2,
        "category": "coran"
    },
    {
        "id": "q5",
        "question": "Pendant combien de jours dure le mois de Ramadan ?",
        "options": ["28 jours", "29 ou 30 jours", "30 jours exactement", "31 jours"],
        "correct_answer": 1,
        "category": "ramadan"
    },
    {
        "id": "q6",
        "question": "Combien de prières obligatoires un musulman doit-il accomplir chaque jour ?",
        "options": ["3", "4", "5", "7"],
        "correct_answer": 2,
        "category": "priere"
    },
    {
        "id": "q7",
        "question": "Quel prophète a construit la Kaaba ?",
        "options": ["Moïse (Moussa)", "Jésus (Issa)", "Abraham (Ibrahim)", "Noé (Nouh)"],
        "correct_answer": 2,
        "category": "prophetes"
    },
    {
        "id": "q8",
        "question": "Quelle est la direction vers laquelle les musulmans se tournent pour prier ?",
        "options": ["Jérusalem", "Médine", "La Mecque (Qibla)", "Le Caire"],
        "correct_answer": 2,
        "category": "priere"
    },
    {
        "id": "q9",
        "question": "Quel est le livre saint de l'Islam ?",
        "options": ["La Torah", "L'Évangile", "Le Coran", "Les Psaumes"],
        "correct_answer": 2,
        "category": "coran"
    },
    {
        "id": "q10",
        "question": "Pendant quel mois le Coran a-t-il été révélé ?",
        "options": ["Shawwal", "Ramadan", "Dhul Hijjah", "Muharram"],
        "correct_answer": 1,
        "category": "coran"
    },
    {
        "id": "q11",
        "question": "Qu'est-ce que la Zakat ?",
        "options": ["Le pèlerinage", "L'aumône obligatoire", "Le jeûne", "La prière"],
        "correct_answer": 1,
        "category": "piliers"
    },
    {
        "id": "q12",
        "question": "Quel est le dernier prophète en Islam ?",
        "options": ["Jésus (Issa)", "Moïse (Moussa)", "Muhammad ﷺ", "Abraham (Ibrahim)"],
        "correct_answer": 2,
        "category": "prophetes"
    },
    {
        "id": "q13",
        "question": "Combien d'anges sont mentionnés par leur nom dans le Coran ?",
        "options": ["2", "4", "6", "10"],
        "correct_answer": 1,
        "category": "croyance"
    },
    {
        "id": "q14",
        "question": "Quelle est la nuit la plus importante du Ramadan ?",
        "options": ["La première nuit", "Laylat al-Qadr", "La 15ème nuit", "La dernière nuit"],
        "correct_answer": 1,
        "category": "ramadan"
    },
    {
        "id": "q15",
        "question": "Où est né le Prophète Muhammad ﷺ ?",
        "options": ["Médine", "Jérusalem", "La Mecque", "Taif"],
        "correct_answer": 2,
        "category": "prophetes"
    }
]

import random
import json

@api_router.post("/quiz/start")
async def start_quiz(category: Optional[str] = None):
    """Generate 10 new quiz questions using AI and start a quiz session"""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    
    category_hint = ""
    if category:
        category_names = {
            "piliers": "les 5 piliers de l'Islam",
            "coran": "le Coran",
            "priere": "la prière",
            "ramadan": "le Ramadan",
            "prophetes": "les prophètes",
            "croyance": "la croyance islamique"
        }
        category_hint = f" Les questions doivent porter sur {category_names.get(category, category)}."
    
    variety_seed = random.randint(1, 999999)
    prompt = f"""Génère exactement 10 questions de quiz sur l'Islam en français.{category_hint}

Chaque question doit avoir exactement 4 options de réponse.
Les catégories possibles sont: piliers, coran, priere, ramadan, prophetes, croyance.

Retourne UNIQUEMENT un tableau JSON valide avec cette structure:
[
  {{
    "question": "La question ici ?",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correct_answer": 0,
    "category": "piliers"
  }}
]

Règles:
- correct_answer est l'index (0-3) de la bonne réponse dans le tableau options
- Les questions doivent être variées et couvrir différents aspects
- Les questions doivent être précises avec une seule bonne réponse
- Ne répète pas de questions banales, sois créatif et éducatif
- VARIÉTÉ : ceci est une nouvelle série (référence #{variety_seed}). Génère des questions DIFFÉRENTES des séries habituelles : varie les formulations, les thèmes abordés et le niveau de difficulté. N'utilise pas toujours les mêmes questions classiques.
- Retourne UNIQUEMENT le JSON, rien d'autre"""

    questions = None
    
    try:
        chat = LlmChat(
            api_key=AI_LLM_KEY,
            session_id=f"quiz_gen_{uuid.uuid4()}",
            system_message="Tu es un générateur de quiz islamique. Tu retournes uniquement du JSON valide, sans markdown, sans commentaire."
        ).with_model("gemini", "gemini-2.5-flash").with_params(max_tokens=4096, temperature=1.0)
        
        response = await chat.send_message(UserMessage(text=prompt))
        
        # Parse JSON from response - handle markdown fences and stray text
        text = response.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            text = text.rsplit("```", 1)[0]
        # Extract the JSON array even if wrapped in extra text
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1 and end > start:
            text = text[start:end + 1]

        parsed = json.loads(text)
        
        if isinstance(parsed, list) and len(parsed) >= 1:
            questions = parsed[:10]
    except Exception as e:
        logger.error(f"AI quiz generation error: {e}")
    
    # Fallback to static questions if AI fails
    if not questions or len(questions) < 10:
        source_questions = QUIZ_QUESTIONS
        if category:
            filtered = [q for q in source_questions if q["category"] == category]
            if len(filtered) >= 4:
                source_questions = filtered
        
        selected = random.sample(source_questions, min(10, len(source_questions)))
        questions = [{"question": q["question"], "options": q["options"], "correct_answer": q["correct_answer"], "category": q["category"]} for q in selected]
        random.shuffle(questions)
    
    # Build session
    session_id = str(uuid.uuid4())
    session_questions = []
    for i, q in enumerate(questions):
        session_questions.append({
            "index": i,
            "question": q["question"],
            "options": q["options"],
            "correct_answer": q["correct_answer"],
            "category": q.get("category", "general")
        })
    
    await db.quiz_sessions.insert_one({
        "session_id": session_id,
        "questions": session_questions,
        "answers": {},
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    # Return questions WITHOUT correct_answer
    public_questions = []
    for q in session_questions:
        public_questions.append({
            "index": q["index"],
            "question": q["question"],
            "options": q["options"],
            "category": q["category"]
        })
    
    return {"session_id": session_id, "questions": public_questions}


class QuizSessionAnswer(BaseModel):
    question_index: int
    answer: int


@api_router.post("/quiz/session/{session_id}/answer")
async def submit_session_answer(session_id: str, body: QuizSessionAnswer, user: dict = Depends(get_optional_user)):
    """Submit an answer for a question in a quiz session"""
    session = await db.quiz_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=404, detail="Session de quiz non trouvée")
    
    qi = body.question_index
    if qi < 0 or qi >= len(session["questions"]):
        raise HTTPException(status_code=400, detail="Index de question invalide")
    
    question = session["questions"][qi]
    is_correct = body.answer == question["correct_answer"]
    
    # Store answer in session
    await db.quiz_sessions.update_one(
        {"session_id": session_id},
        {"$set": {f"answers.{qi}": {"answer": body.answer, "is_correct": is_correct}}}
    )
    
    # Save to user history
    if user:
        await db.quiz_history.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "question_id": f"{session_id}_{qi}",
            "answer": body.answer,
            "is_correct": is_correct,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    
    return {
        "correct": is_correct,
        "correct_answer": question["correct_answer"],
        "correct_option": question["options"][question["correct_answer"]]
    }


@api_router.get("/quiz/question")
async def get_quiz_question(category: Optional[str] = None):
    """Get a random quiz question"""
    questions = QUIZ_QUESTIONS
    if category:
        questions = [q for q in questions if q["category"] == category]
    
    if not questions:
        raise HTTPException(status_code=404, detail="Aucune question trouvée")
    
    question = random.choice(questions)
    return {
        "id": question["id"],
        "question": question["question"],
        "options": question["options"],
        "category": question["category"]
    }

@api_router.post("/quiz/answer")
async def submit_quiz_answer(answer: QuizAnswerRequest, user: dict = Depends(get_optional_user)):
    """Submit a quiz answer"""
    question = next((q for q in QUIZ_QUESTIONS if q["id"] == answer.question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="Question non trouvée")
    
    is_correct = answer.answer == question["correct_answer"]
    
    # Save to history if user is logged in
    if user:
        await db.quiz_history.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "question_id": answer.question_id,
            "answer": answer.answer,
            "is_correct": is_correct,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    
    return {
        "correct": is_correct,
        "correct_answer": question["correct_answer"],
        "correct_option": question["options"][question["correct_answer"]]
    }

@api_router.get("/quiz/categories")
async def get_quiz_categories():
    """Get all quiz categories"""
    return ["piliers", "coran", "priere", "ramadan", "prophetes", "croyance"]

@api_router.get("/quiz/stats")
async def get_quiz_stats(user: dict = Depends(get_current_user)):
    """Get user's quiz statistics"""
    history = await db.quiz_history.find(
        {"user_id": user["id"]},
        {"_id": 0}
    ).to_list(1000)
    
    total = len(history)
    correct = sum(1 for h in history if h["is_correct"])
    
    return {
        "total_questions": total,
        "correct_answers": correct,
        "accuracy": round((correct / total * 100) if total > 0 else 0, 1)
    }


# ============== MULTIPLAYER QUIZ: LOBBIES + REAL-TIME READY STATE ==============

MULTIPLAYER_CAPACITIES = {2, 4, 6, 8, 10}
MULTIPLAYER_REACTIONS = {
    "well_played": "Bien joué !",
    "bravo": "Bravo !",
    "congrats": "Félicitations !",
    "good_luck": "Bonne chance !",
    "nice_answer": "Belle réponse !",
}
multiplayer_countdown_tasks: Dict[str, asyncio.Task] = {}
multiplayer_game_tasks: Dict[str, asyncio.Task] = {}
multiplayer_round_events: Dict[str, asyncio.Event] = {}

MULTIPLAYER_CATEGORIES = {
    "general", "piliers", "coran", "priere", "ramadan", "prophetes", "croyance"
}
MULTIPLAYER_DIFFICULTIES = {"debutant", "facile", "moyen", "difficile", "expert"}
MULTIPLAYER_SAFE_QUESTION_IDS = {
    "q1", "q2", "q3", "q4", "q5", "q6", "q8", "q9", "q10", "q11", "q12", "q14", "q15"
}
MULTIPLAYER_QUESTION_SOURCES = {
    "q1": "Sahih al-Bukhari, hadith 8 ; Sahih Muslim, hadith 16",
    "q2": "Sahih al-Bukhari, hadith 8 ; Sahih Muslim, hadith 16",
    "q3": "Mushaf du Coran : 114 sourates",
    "q4": "Mushaf du Coran : sourate Al-Fatiha",
    "q5": "Sahih al-Bukhari, hadith 1907",
    "q6": "Sahih al-Bukhari, hadith 349 ; Sahih Muslim, hadith 163",
    "q8": "Coran, sourate Al-Baqara, verset 144",
    "q9": "Coran, sourate Al-Baqara, verset 2",
    "q10": "Coran, sourate Al-Baqara, verset 185",
    "q11": "Coran, sourate At-Tawba, verset 60",
    "q12": "Coran, sourate Al-Ahzab, verset 40",
    "q14": "Coran, sourate Al-Qadr",
    "q15": "Sira d'Ibn Hisham, naissance du Prophète ﷺ à La Mecque",
}


class MultiplayerRoomCreate(BaseModel):
    max_players: int = 2
    visibility: str = "public"
    category: str = "general"
    difficulty: str = "moyen"
    question_count: int = 10
    question_time: int = 15


class MultiplayerJoin(BaseModel):
    code: str


class MultiplayerReady(BaseModel):
    ready: bool


class MultiplayerReaction(BaseModel):
    reaction: str


class MultiplayerAnswer(BaseModel):
    question_index: int
    answer: int

class MultiplayerQuestionReport(BaseModel):
    room_code: Optional[str] = None
    question_id: Optional[str] = None
    reason: str = Field(..., min_length=3, max_length=120)
    details: Optional[str] = Field(default="", max_length=1000)

class MultiplayerPlayerReport(BaseModel):
    target_user_id: str
    reason: str = Field(..., min_length=3, max_length=120)
    details: Optional[str] = Field(default="", max_length=1000)

class FounderSubscriptionGift(BaseModel):
    user_id: str
    plan: str = "neura_ultra"
    months: int = Field(default=1, ge=1, le=12)
    reason: Optional[str] = Field(default="", max_length=500)


class MultiplayerConnectionManager:
    def __init__(self):
        self.connections: Dict[str, Dict[str, set]] = {}
        self.lock = asyncio.Lock()

    async def connect(self, room_code: str, user_id: str, websocket: WebSocket):
        await websocket.accept()
        async with self.lock:
            room_connections = self.connections.setdefault(room_code, {})
            room_connections.setdefault(user_id, set()).add(websocket)

    async def disconnect(self, room_code: str, user_id: str, websocket: WebSocket) -> bool:
        """Return True only when this was the user's last socket in the room."""
        async with self.lock:
            room_connections = self.connections.get(room_code, {})
            user_connections = room_connections.get(user_id, set())
            user_connections.discard(websocket)
            if user_connections:
                return False
            room_connections.pop(user_id, None)
            if not room_connections:
                self.connections.pop(room_code, None)
            return True

    async def broadcast(self, room_code: str, payload: dict):
        async with self.lock:
            sockets = [
                socket
                for user_sockets in self.connections.get(room_code, {}).values()
                for socket in user_sockets
            ]
        stale = []
        for socket in sockets:
            try:
                await socket.send_json(payload)
            except Exception:
                stale.append(socket)
        if stale:
            async with self.lock:
                for user_id, user_sockets in list(self.connections.get(room_code, {}).items()):
                    user_sockets.difference_update(stale)
                    if not user_sockets:
                        self.connections.get(room_code, {}).pop(user_id, None)


multiplayer_connections = MultiplayerConnectionManager()


def _public_game(room: dict) -> Optional[dict]:
    game = room.get("game")
    if not game:
        return None
    question = None
    index = int(game.get("current_index", -1))
    questions = game.get("questions", [])
    if 0 <= index < len(questions):
        source_question = questions[index]
        question = {
            "index": index,
            "id": source_question.get("id"),
            "question": source_question["question"],
            "options": source_question["options"],
            "category": source_question.get("category", "general"),
        }
        if game.get("phase") in ("reveal", "ranking", "finished"):
            correct_index = int(source_question["correct_answer"])
            question.update({
                "correct_answer": correct_index,
                "correct_option": source_question["options"][correct_index],
                "explanation": source_question.get("explanation"),
                "source": source_question.get("source"),
            })
    return {
        "phase": game.get("phase", "waiting"),
        "current_index": index,
        "total_questions": int(game.get("total_questions", 0)),
        "question": question,
        "question_started_at": game.get("question_started_at"),
        "question_ends_at": game.get("question_ends_at"),
        "answered_user_ids": [answer["user_id"] for answer in game.get("round_answers", [])],
        "is_tiebreak": bool(game.get("is_tiebreak", False)),
        "winner_ids": game.get("winner_ids", []),
        "finished_at": game.get("finished_at"),
    }


def _public_room(room: dict) -> dict:
    if not room:
        return {}
    players = sorted(room.get("players", []), key=lambda player: player.get("joined_at", ""))
    return {
        "room_id": room["room_id"],
        "code": room["code"],
        "visibility": room["visibility"],
        "max_players": room["max_players"],
        "category": room.get("category", "general"),
        "difficulty": room.get("difficulty", "moyen"),
        "question_count": int(room.get("question_count", 10)),
        "question_time": int(room.get("question_time", 15)),
        "status": room.get("status", "waiting"),
        "creator_id": room.get("creator_id"),
        "player_count": len(players),
        "players": [
            {
                "user_id": player["user_id"],
                "name": player.get("name", "Joueur"),
                "level": int(player.get("level", 1)),
                "xp": int(player.get("xp", 0)),
                "ready": bool(player.get("ready", False)),
                "connected": bool(player.get("connected", False)),
                "score": int(player.get("score", 0)),
                "correct_count": int(player.get("correct_count", 0)),
                "wrong_count": int(player.get("wrong_count", 0)),
                "streak": int(player.get("streak", 0)),
                "best_streak": int(player.get("best_streak", 0)),
                "xp_earned": int(player.get("xp_earned", 0)),
                "level_gained": int(player.get("level_gained", 0)),
                "badges_earned": player.get("badges_earned", []),
                "abandoned": bool(player.get("abandoned", False)),
                "joined_at": player.get("joined_at"),
            }
            for player in players
        ],
        "created_at": room.get("created_at"),
        "updated_at": room.get("updated_at"),
        "game": _public_game(room),
    }


def _founder_admin_role(user: dict) -> Optional[str]:
    email = (user.get("email") or "").strip().lower()
    if is_founder(email):
        return "founder"
    if user.get("is_vip") or is_vip_email(email):
        return "admin"
    return None


async def _require_founder_admin(user: dict) -> str:
    role = _founder_admin_role(user)
    if not role:
        raise HTTPException(status_code=403, detail="Acces reserve aux fondateurs et administrateurs.")
    return role


async def _admin_log(action: str, actor: dict, target_user_id: Optional[str] = None, metadata: Optional[dict] = None):
    await db.founder_admin_logs.insert_one({
        "id": str(uuid.uuid4()),
        "action": action,
        "actor_id": actor.get("id"),
        "actor_email": actor.get("email"),
        "target_user_id": target_user_id,
        "metadata": metadata or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


def _period_start(period: str) -> Optional[datetime]:
    now = datetime.now(timezone.utc)
    if period == "today":
        return now.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "week":
        start = now - timedelta(days=now.weekday())
        return start.replace(hour=0, minute=0, second=0, microsecond=0)
    if period == "month":
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if period == "year":
        return now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return None


def _season_name(now: Optional[datetime] = None) -> str:
    now = now or datetime.now(timezone.utc)
    if now.month in (3, 4, 5):
        return "Printemps"
    if now.month in (6, 7, 8):
        return "Ete"
    if now.month in (9, 10, 11):
        return "Automne"
    return "Hiver"


async def _multiplayer_leaderboard(period: str = "all", limit: int = 100) -> List[dict]:
    query = {}
    start = _period_start(period)
    if start:
        query["played_at"] = {"$gte": start.isoformat()}
    pipeline = [
        {"$match": query},
        {"$group": {
            "_id": "$user_id",
            "score": {"$sum": "$score"},
            "games": {"$sum": 1},
            "wins": {"$sum": {"$cond": ["$won", 1, 0]}},
            "correct": {"$sum": "$correct_count"},
            "wrong": {"$sum": "$wrong_count"},
            "xp": {"$sum": "$xp_earned"},
            "average_ms": {"$avg": "$average_response_ms"},
        }},
        {"$sort": {"score": -1, "wins": -1, "correct": -1, "average_ms": 1}},
        {"$limit": max(1, min(limit, 100))},
    ]
    rows = await db.multiplayer_history.aggregate(pipeline).to_list(limit)
    users = await db.users.find(
        {"id": {"$in": [row["_id"] for row in rows]}},
        {"_id": 0, "id": 1, "name": 1, "email": 1, "picture": 1, "username": 1}
    ).to_list(len(rows) or 1)
    users_by_id = {item["id"]: item for item in users}
    result = []
    for position, row in enumerate(rows, start=1):
        profile = users_by_id.get(row["_id"], {})
        answered = int(row.get("correct", 0)) + int(row.get("wrong", 0))
        result.append({
            "position": position,
            "user_id": row["_id"],
            "name": profile.get("name") or "Utilisateur",
            "email": profile.get("email"),
            "picture": profile.get("picture"),
            "score": int(row.get("score", 0)),
            "games": int(row.get("games", 0)),
            "wins": int(row.get("wins", 0)),
            "correct": int(row.get("correct", 0)),
            "wrong": int(row.get("wrong", 0)),
            "accuracy": round(int(row.get("correct", 0)) / answered * 100, 1) if answered else 0,
            "xp": int(row.get("xp", 0)),
            "average_response_ms": round(row.get("average_ms") or 0),
        })
    return result


async def _room_by_code(code: str) -> dict:
    return await db.multiplayer_rooms.find_one({"code": code.strip().upper()}, {"_id": 0})


def _new_multiplayer_player(user: dict) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "user_id": user["id"],
        "name": user.get("name") or "Joueur",
        "level": int(user.get("quiz_level", 1)),
        "xp": int(user.get("quiz_xp", 0)),
        "ready": False,
        "connected": False,
        "score": 0,
        "correct_count": 0,
        "wrong_count": 0,
        "streak": 0,
        "best_streak": 0,
        "answered_count": 0,
        "total_response_ms": 0,
        "xp_earned": 0,
        "level_gained": 0,
        "badges_earned": [],
        "abandoned": False,
        "joined_at": now,
        "last_seen": now,
    }


async def _unique_room_code() -> str:
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    for _ in range(20):
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        if not await db.multiplayer_rooms.find_one({"code": code}, {"_id": 1}):
            return code
    raise HTTPException(status_code=503, detail="Impossible de créer un code de salle. Réessayez.")


async def _broadcast_room(code: str, event: str = "room_state", **extra):
    room = await _room_by_code(code)
    if room:
        await multiplayer_connections.broadcast(
            code,
            {"type": event, "room": _public_room(room), **extra},
        )


def _room_can_countdown(room: dict) -> bool:
    players = room.get("players", [])
    return (
        room.get("status") in ("waiting", "countdown")
        and len(players) >= 2
        and len(players) <= int(room.get("max_players", 0))
        and all(player.get("connected") and player.get("ready") for player in players)
    )


async def _cancel_multiplayer_countdown(code: str):
    task = multiplayer_countdown_tasks.pop(code, None)
    if task and task is not asyncio.current_task() and not task.done():
        task.cancel()
    await db.multiplayer_rooms.update_one(
        {"code": code, "status": "countdown"},
        {"$set": {"status": "waiting", "updated_at": datetime.now(timezone.utc).isoformat()},
         "$unset": {"countdown_id": ""}},
    )


def _multiplayer_question_pool(room: dict) -> list:
    category = room.get("category", "general")
    pool = [q for q in QUIZ_QUESTIONS if q.get("id") in MULTIPLAYER_SAFE_QUESTION_IDS]
    if category != "general":
        category_pool = [q for q in pool if q.get("category") == category]
        if category_pool:
            pool = category_pool
    random.shuffle(pool)
    prepared = []
    for question in pool:
        correct_index = int(question["correct_answer"])
        prepared.append({
            "id": question["id"],
            "question": question["question"],
            "options": list(question["options"]),
            "correct_answer": correct_index,
            "category": question.get("category", "general"),
            "explanation": f"La bonne réponse est « {question['options'][correct_index]} ».",
            "source": MULTIPLAYER_QUESTION_SOURCES.get(question["id"], "Banque éditoriale NEURA AL-NOUR"),
        })
    return prepared


def _rank_multiplayer_players(room: dict) -> list:
    def ranking_key(player):
        answered = max(1, int(player.get("answered_count", 0)))
        average_ms = int(player.get("total_response_ms", 0)) / answered
        return (
            -int(player.get("score", 0)),
            -int(player.get("correct_count", 0)),
            average_ms,
            player.get("joined_at", ""),
        )
    return sorted(room.get("players", []), key=ranking_key)


async def _set_multiplayer_phase(code: str, phase: str, **fields):
    now = datetime.now(timezone.utc).isoformat()
    values = {"game.phase": phase, "updated_at": now, **fields}
    await db.multiplayer_rooms.update_one(
        {"code": code, "status": "playing"}, {"$set": values}
    )
    await _broadcast_room(code, f"game_{phase}")


async def _finish_multiplayer_game(code: str):
    room = await _room_by_code(code)
    if not room or room.get("status") != "playing":
        return
    ranked = _rank_multiplayer_players(room)
    if not ranked:
        return
    winning_score = int(ranked[0].get("score", 0))
    winner_ids = [p["user_id"] for p in ranked if int(p.get("score", 0)) == winning_score]
    now = datetime.now(timezone.utc).isoformat()

    for position, player in enumerate(ranked, start=1):
        participation_xp = 10 + int(player.get("correct_count", 0)) * 5
        if player["user_id"] in winner_ids:
            participation_xp += 20
        user_doc = await db.users.find_one({"id": player["user_id"]}, {"_id": 0}) or {}
        old_xp = int(user_doc.get("quiz_xp", 0))
        old_level = int(user_doc.get("quiz_level", max(1, old_xp // 100 + 1)))
        new_xp = old_xp + participation_xp
        new_level = max(1, new_xp // 100 + 1)
        previous_history = await db.multiplayer_history.find(
            {"user_id": player["user_id"]}, {"_id": 0, "won": 1, "correct_count": 1}
        ).to_list(1000)
        total_correct = sum(int(item.get("correct_count", 0)) for item in previous_history) + int(player.get("correct_count", 0))
        total_wins = sum(1 for item in previous_history if item.get("won")) + (1 if player["user_id"] in winner_ids else 0)
        badges = []
        if not previous_history:
            badges.append("Premier quiz multijoueur")
        for threshold in (100, 500, 1000):
            if total_correct >= threshold:
                badges.append(f"{threshold} bonnes réponses")
        for threshold in (10, 50, 100):
            if total_wins >= threshold:
                badges.append(f"{threshold} victoires")
        for threshold in (3, 5, 10):
            if int(player.get("best_streak", 0)) >= threshold:
                badges.append(f"Série de {threshold}")
        await db.multiplayer_rooms.update_one(
            {"code": code, "players.user_id": player["user_id"]},
            {"$set": {
                "players.$.xp_earned": participation_xp,
                "players.$.level": new_level,
                "players.$.xp": new_xp,
                "players.$.level_gained": max(0, new_level - old_level),
                "players.$.badges_earned": badges,
            }},
        )
        await db.users.update_one(
            {"id": player["user_id"]},
            {"$set": {"quiz_xp": new_xp, "quiz_level": new_level}},
        )
        answered = int(player.get("answered_count", 0))
        average_ms = round(int(player.get("total_response_ms", 0)) / answered) if answered else 0
        await db.multiplayer_history.insert_one({
            "id": str(uuid.uuid4()),
            "room_id": room["room_id"],
            "user_id": player["user_id"],
            "played_at": now,
            "score": int(player.get("score", 0)),
            "position": position,
            "player_count": len(ranked),
            "category": room.get("category", "general"),
            "difficulty": room.get("difficulty", "moyen"),
            "correct_count": int(player.get("correct_count", 0)),
            "wrong_count": int(player.get("wrong_count", 0)),
            "average_response_ms": average_ms,
            "xp_earned": participation_xp,
            "level": new_level,
            "level_gained": max(0, new_level - old_level),
            "badges_earned": badges,
            "won": player["user_id"] in winner_ids,
            "abandoned": bool(player.get("abandoned", False)),
        })

    await db.multiplayer_rooms.update_one(
        {"code": code, "status": "playing"},
        {"$set": {
            "status": "finished",
            "game.phase": "finished",
            "game.winner_ids": winner_ids,
            "game.finished_at": now,
            "updated_at": now,
        }},
    )
    await _broadcast_room(code, "game_finished")


async def _run_multiplayer_game(code: str):
    try:
        room = await _room_by_code(code)
        if not room or room.get("status") != "playing":
            return
        game = room.get("game", {})
        total = int(game.get("total_questions", 0))
        for index in range(total):
            room = await _room_by_code(code)
            if not room or room.get("status") != "playing":
                return
            now = datetime.now(timezone.utc)
            end = now + timedelta(seconds=int(room.get("question_time", 15)))
            event = asyncio.Event()
            multiplayer_round_events[code] = event
            await db.multiplayer_rooms.update_one(
                {"code": code, "status": "playing"},
                {"$set": {
                    "game.phase": "question",
                    "game.current_index": index,
                    "game.question_started_at": now.isoformat(),
                    "game.question_ends_at": end.isoformat(),
                    "game.round_answers": [],
                    "game.is_tiebreak": False,
                    "updated_at": now.isoformat(),
                }, "$unset": {"game.first_correct_user_id": ""}},
            )
            await _broadcast_room(code, "game_question")
            try:
                await asyncio.wait_for(event.wait(), timeout=max(0.1, (end - datetime.now(timezone.utc)).total_seconds()))
            except asyncio.TimeoutError:
                pass

            await _set_multiplayer_phase(code, "reveal")
            await asyncio.sleep(3)
            await _set_multiplayer_phase(code, "ranking")
            await asyncio.sleep(2)

        reserve_index = total
        while True:
            room = await _room_by_code(code)
            ranked = _rank_multiplayer_players(room)
            if not ranked:
                return
            top_score = int(ranked[0].get("score", 0))
            tied_ids = [p["user_id"] for p in ranked if int(p.get("score", 0)) == top_score]
            questions = room.get("game", {}).get("questions", [])
            if len(tied_ids) <= 1:
                break
            if reserve_index >= len(questions):
                # Deterministic final fallback after all decisive questions: best accuracy, then speed.
                await db.multiplayer_rooms.update_one(
                    {"code": code, "players.user_id": ranked[0]["user_id"]},
                    {"$inc": {"players.$.score": 1}},
                )
                break
            now = datetime.now(timezone.utc)
            end = now + timedelta(seconds=int(room.get("question_time", 15)))
            event = asyncio.Event()
            multiplayer_round_events[code] = event
            await db.multiplayer_rooms.update_one(
                {"code": code, "status": "playing"},
                {"$set": {
                    "game.phase": "question",
                    "game.current_index": reserve_index,
                    "game.question_started_at": now.isoformat(),
                    "game.question_ends_at": end.isoformat(),
                    "game.round_answers": [],
                    "game.is_tiebreak": True,
                    "game.tiebreak_user_ids": tied_ids,
                    "updated_at": now.isoformat(),
                }, "$unset": {"game.first_correct_user_id": ""}},
            )
            await _broadcast_room(code, "game_tiebreak")
            try:
                await asyncio.wait_for(event.wait(), timeout=max(0.1, (end - datetime.now(timezone.utc)).total_seconds()))
            except asyncio.TimeoutError:
                pass
            await _set_multiplayer_phase(code, "reveal")
            await asyncio.sleep(3)
            await _set_multiplayer_phase(code, "ranking")
            await asyncio.sleep(2)
            reserve_index += 1

        await _finish_multiplayer_game(code)
    except asyncio.CancelledError:
        return
    except Exception as error:
        logger.error(f"Multiplayer game error for {code}: {error}")
        await db.multiplayer_rooms.update_one(
            {"code": code, "status": "playing"},
            {"$set": {"status": "finished", "game.phase": "finished", "game.error": True}},
        )
        await _broadcast_room(code, "game_error")
    finally:
        multiplayer_round_events.pop(code, None)
        if multiplayer_game_tasks.get(code) is asyncio.current_task():
            multiplayer_game_tasks.pop(code, None)


async def _start_multiplayer_game(code: str, countdown_id: str):
    room = await _room_by_code(code)
    if not room or room.get("countdown_id") != countdown_id or not _room_can_countdown(room):
        await _cancel_multiplayer_countdown(code)
        return False
    questions = _multiplayer_question_pool(room)
    requested = int(room.get("question_count", 10))
    selected = questions[:]
    if len(selected) < requested + 3:
        general_room = {**room, "category": "general"}
        selected_ids = {q["id"] for q in selected}
        selected.extend(q for q in _multiplayer_question_pool(general_room) if q["id"] not in selected_ids)
    main_total = min(requested, len(selected))
    selected = selected[:min(len(selected), main_total + 3)]
    if not selected:
        return False
    now = datetime.now(timezone.utc).isoformat()
    await db.multiplayer_rooms.update_one(
        {"code": code, "countdown_id": countdown_id, "status": "countdown"},
        {"$set": {
            "status": "playing",
            "game": {
                "phase": "welcome",
                "current_index": -1,
                "total_questions": main_total,
                "questions": selected,
                "round_answers": [],
                "started_at": now,
                "winner_ids": [],
            },
            "updated_at": now,
        }, "$unset": {"countdown_id": ""}},
    )
    await _broadcast_room(code, "game_welcome")
    task = asyncio.create_task(_run_multiplayer_game(code))
    multiplayer_game_tasks[code] = task
    return True


async def _multiplayer_countdown(code: str, countdown_id: str):
    try:
        for value in (3, 2, 1):
            room = await _room_by_code(code)
            if not room or room.get("countdown_id") != countdown_id or not _room_can_countdown(room):
                await _cancel_multiplayer_countdown(code)
                await _broadcast_room(code, "countdown_cancelled")
                return
            await multiplayer_connections.broadcast(
                code,
                {"type": "countdown", "value": value, "room": _public_room(room)},
            )
            await asyncio.sleep(1)

        room = await _room_by_code(code)
        if not room or room.get("countdown_id") != countdown_id or not _room_can_countdown(room):
            await _cancel_multiplayer_countdown(code)
            await _broadcast_room(code, "countdown_cancelled")
            return
        await _start_multiplayer_game(code, countdown_id)
    except asyncio.CancelledError:
        return
    finally:
        if multiplayer_countdown_tasks.get(code) is asyncio.current_task():
            multiplayer_countdown_tasks.pop(code, None)


async def _evaluate_multiplayer_countdown(code: str):
    room = await _room_by_code(code)
    if not room:
        return
    if _room_can_countdown(room):
        existing = multiplayer_countdown_tasks.get(code)
        if existing and not existing.done():
            return
        countdown_id = str(uuid.uuid4())
        updated = await db.multiplayer_rooms.update_one(
            {"code": code, "status": "waiting"},
            {"$set": {
                "status": "countdown",
                "countdown_id": countdown_id,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
        )
        if updated.modified_count:
            task = asyncio.create_task(_multiplayer_countdown(code, countdown_id))
            multiplayer_countdown_tasks[code] = task
    elif room.get("status") == "countdown":
        await _cancel_multiplayer_countdown(code)
        await _broadcast_room(code, "countdown_cancelled")


async def _join_multiplayer_room(room: dict, user: dict) -> dict:
    if any(player.get("user_id") == user["id"] for player in room.get("players", [])):
        return room
    now = datetime.now(timezone.utc).isoformat()
    result = await db.multiplayer_rooms.update_one(
        {
            "code": room["code"],
            "status": "waiting",
            "players.user_id": {"$ne": user["id"]},
            "$expr": {"$lt": [{"$size": "$players"}, "$max_players"]},
        },
        {"$push": {"players": _new_multiplayer_player(user)}, "$set": {"updated_at": now}},
    )
    if not result.modified_count:
        current = await _room_by_code(room["code"])
        if current and any(player.get("user_id") == user["id"] for player in current.get("players", [])):
            return current
        raise HTTPException(status_code=409, detail="Cette salle est pleine ou a déjà démarré.")
    joined = await _room_by_code(room["code"])
    await _broadcast_room(room["code"], "player_joined", user_id=user["id"])
    return joined


@api_router.post("/multiplayer/rooms")
async def create_multiplayer_room(data: MultiplayerRoomCreate, user: dict = Depends(get_current_user)):
    if data.max_players not in MULTIPLAYER_CAPACITIES:
        raise HTTPException(status_code=400, detail="Capacité autorisée : 2, 4, 6, 8 ou 10 joueurs.")
    visibility = data.visibility.strip().lower()
    if visibility not in ("public", "private"):
        raise HTTPException(status_code=400, detail="La salle doit être publique ou privée.")
    category = data.category.strip().lower()
    if category not in MULTIPLAYER_CATEGORIES:
        raise HTTPException(status_code=400, detail="Catégorie de quiz invalide.")
    difficulty = data.difficulty.strip().lower()
    if difficulty not in MULTIPLAYER_DIFFICULTIES:
        raise HTTPException(status_code=400, detail="Difficulté de quiz invalide.")
    if data.question_count < 3 or data.question_count > 15:
        raise HTTPException(status_code=400, detail="Le quiz doit contenir entre 3 et 15 questions.")
    if data.question_time not in (10, 15, 20, 30):
        raise HTTPException(status_code=400, detail="Durée autorisée : 10, 15, 20 ou 30 secondes.")
    code = await _unique_room_code()
    now = datetime.now(timezone.utc).isoformat()
    room = {
        "room_id": str(uuid.uuid4()),
        "code": code,
        "visibility": visibility,
        "max_players": data.max_players,
        "category": category,
        "difficulty": difficulty,
        "question_count": data.question_count,
        "question_time": data.question_time,
        "status": "waiting",
        "creator_id": user["id"],
        "players": [_new_multiplayer_player(user)],
        "created_at": now,
        "updated_at": now,
    }
    await db.multiplayer_rooms.insert_one(room)
    room.pop("_id", None)
    return _public_room(room)


@api_router.get("/multiplayer/rooms/public")
async def list_public_multiplayer_rooms(user: dict = Depends(get_current_user)):
    rooms = await db.multiplayer_rooms.find(
        {"visibility": "public", "status": "waiting"}, {"_id": 0}
    ).sort("updated_at", -1).to_list(50)
    return [
        _public_room(room)
        for room in rooms
        if len(room.get("players", [])) < int(room.get("max_players", 0))
    ]


@api_router.post("/multiplayer/quick-match")
async def quick_multiplayer_match(user: dict = Depends(get_current_user)):
    existing = await db.multiplayer_rooms.find_one(
        {"status": "waiting", "players.user_id": user["id"]}, {"_id": 0}
    )
    if existing:
        return _public_room(existing)
    rooms = await db.multiplayer_rooms.find(
        {"visibility": "public", "status": "waiting"}, {"_id": 0}
    ).sort("created_at", 1).to_list(50)
    for room in rooms:
        if len(room.get("players", [])) < int(room.get("max_players", 0)):
            return _public_room(await _join_multiplayer_room(room, user))
    return await create_multiplayer_room(
        MultiplayerRoomCreate(max_players=10, visibility="public"), user
    )


@api_router.post("/multiplayer/rooms/join")
async def join_multiplayer_room(data: MultiplayerJoin, user: dict = Depends(get_current_user)):
    room = await _room_by_code(data.code)
    if not room:
        raise HTTPException(status_code=404, detail="Salle introuvable. Vérifiez le code.")
    return _public_room(await _join_multiplayer_room(room, user))


@api_router.get("/multiplayer/rooms/{code}")
async def get_multiplayer_room(code: str, user: dict = Depends(get_current_user)):
    room = await _room_by_code(code)
    if not room:
        raise HTTPException(status_code=404, detail="Salle introuvable.")
    if not any(player.get("user_id") == user["id"] for player in room.get("players", [])):
        raise HTTPException(status_code=403, detail="Vous ne faites pas partie de cette salle.")
    return _public_room(room)


@api_router.post("/multiplayer/rooms/{code}/ready")
async def set_multiplayer_ready(code: str, data: MultiplayerReady, user: dict = Depends(get_current_user)):
    room = await _room_by_code(code)
    if not room:
        raise HTTPException(status_code=404, detail="Salle introuvable.")
    if room.get("status") not in ("waiting", "countdown"):
        raise HTTPException(status_code=409, detail="Le statut Prêt ne peut plus être modifié.")
    result = await db.multiplayer_rooms.update_one(
        {"code": room["code"], "players.user_id": user["id"]},
        {"$set": {
            "players.$.ready": data.ready,
            "players.$.last_seen": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    if not result.matched_count:
        raise HTTPException(status_code=403, detail="Vous ne faites pas partie de cette salle.")
    await _broadcast_room(room["code"], "ready_changed", user_id=user["id"])
    await _evaluate_multiplayer_countdown(room["code"])
    updated = await _room_by_code(room["code"])
    return _public_room(updated)


@api_router.post("/multiplayer/rooms/{code}/answer")
async def submit_multiplayer_answer(code: str, data: MultiplayerAnswer, user: dict = Depends(get_current_user)):
    room = await _room_by_code(code)
    if not room or not any(player.get("user_id") == user["id"] for player in room.get("players", [])):
        raise HTTPException(status_code=403, detail="Vous ne faites pas partie de cette salle.")
    game = room.get("game", {})
    if room.get("status") != "playing" or game.get("phase") != "question":
        raise HTTPException(status_code=409, detail="Aucune question n'accepte de réponse actuellement.")
    current_index = int(game.get("current_index", -1))
    if data.question_index != current_index:
        raise HTTPException(status_code=409, detail="Cette question n'est plus active.")
    questions = game.get("questions", [])
    if current_index < 0 or current_index >= len(questions):
        raise HTTPException(status_code=409, detail="Question active introuvable.")
    question = questions[current_index]
    is_tiebreak = bool(game.get("is_tiebreak", False))
    if is_tiebreak and user["id"] not in game.get("tiebreak_user_ids", []):
        raise HTTPException(status_code=403, detail="Seuls les joueurs à égalité répondent à la question décisive.")
    if data.answer < 0 or data.answer >= len(question.get("options", [])):
        raise HTTPException(status_code=400, detail="Réponse invalide.")
    now = datetime.now(timezone.utc)
    try:
        started_at = datetime.fromisoformat(game["question_started_at"])
        ends_at = datetime.fromisoformat(game["question_ends_at"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=409, detail="Chronomètre de question invalide.")
    if now > ends_at:
        raise HTTPException(status_code=409, detail="Le temps de réponse est terminé.")

    response_ms = max(0, int((now - started_at).total_seconds() * 1000))
    is_correct = data.answer == int(question["correct_answer"])
    answer_record = {
        "user_id": user["id"],
        "answer": data.answer,
        "is_correct": is_correct,
        "response_ms": response_ms,
        "answered_at": now.isoformat(),
    }
    inserted = await db.multiplayer_rooms.update_one(
        {
            "code": room["code"],
            "status": "playing",
            "game.phase": "question",
            "game.current_index": current_index,
            "game.round_answers.user_id": {"$ne": user["id"]},
        },
        {"$push": {"game.round_answers": answer_record}},
    )
    if not inserted.modified_count:
        raise HTTPException(status_code=409, detail="Vous avez déjà répondu à cette question.")

    first_correct = False
    if is_correct:
        first_claim = await db.multiplayer_rooms.update_one(
            {"code": room["code"], "game.first_correct_user_id": {"$exists": False}},
            {"$set": {"game.first_correct_user_id": user["id"]}},
        )
        first_correct = bool(first_claim.modified_count)
    player = next(p for p in room["players"] if p.get("user_id") == user["id"])
    previous_streak = int(player.get("streak", 0))
    new_streak = previous_streak + 1 if is_correct else 0
    time_limit_ms = int(room.get("question_time", 15)) * 1000
    speed_bonus = 0 if is_tiebreak else (3 if is_correct and response_ms <= time_limit_ms // 4 else 0)
    first_bonus = 0 if is_tiebreak else (5 if is_correct and first_correct else 0)
    points = ((1 if first_correct else 0) if is_tiebreak else (10 + speed_bonus + first_bonus)) if is_correct else 0
    player_update = {
        "players.$.streak": new_streak,
        "players.$.best_streak": max(int(player.get("best_streak", 0)), new_streak),
    }
    increments = {
        "players.$.score": points,
        "players.$.answered_count": 1,
        "players.$.total_response_ms": response_ms,
        "players.$.correct_count" if is_correct else "players.$.wrong_count": 1,
    }
    await db.multiplayer_rooms.update_one(
        {"code": room["code"], "players.user_id": user["id"]},
        {"$set": player_update, "$inc": increments},
    )
    updated = await _room_by_code(room["code"])
    await multiplayer_connections.broadcast(room["code"], {
        "type": "answer_received",
        "user_id": user["id"],
        "room": _public_room(updated),
    })
    active_players = [p for p in updated.get("players", []) if not p.get("abandoned")]
    if is_tiebreak:
        eligible_ids = set(updated.get("game", {}).get("tiebreak_user_ids", []))
        active_players = [p for p in active_players if p["user_id"] in eligible_ids]
    if (is_tiebreak and is_correct and first_correct) or len(updated.get("game", {}).get("round_answers", [])) >= len(active_players):
        event = multiplayer_round_events.get(room["code"])
        if event:
            event.set()
    return {
        "accepted": True,
        "correct": is_correct,
        "points": points,
        "base_points": 10 if is_correct else 0,
        "first_bonus": first_bonus,
        "speed_bonus": speed_bonus,
        "streak": new_streak,
    }


@api_router.get("/multiplayer/history")
async def get_multiplayer_history(user: dict = Depends(get_current_user)):
    history = await db.multiplayer_history.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("played_at", -1).to_list(100)
    total = len(history)
    victories = sum(1 for item in history if item.get("won"))
    correct = sum(int(item.get("correct_count", 0)) for item in history)
    wrong = sum(int(item.get("wrong_count", 0)) for item in history)
    answered = correct + wrong
    average_values = [int(item.get("average_response_ms", 0)) for item in history if item.get("average_response_ms")]
    return {
        "matches": history,
        "stats": {
            "total_games": total,
            "victories": victories,
            "accuracy": round(correct / answered * 100, 1) if answered else 0,
            "answered_questions": answered,
            "average_response_ms": round(sum(average_values) / len(average_values)) if average_values else 0,
        },
    }


GAMIFICATION_MISSIONS = [
    {"id": "daily_quiz", "period": "daily", "title": "Reussir un quiz", "target": 1, "xp": 20, "metric": "quiz_completed"},
    {"id": "daily_course", "period": "daily", "title": "Terminer un cours", "target": 1, "xp": 25, "metric": "course_completed"},
    {"id": "daily_exercise", "period": "daily", "title": "Reussir un exercice", "target": 1, "xp": 15, "metric": "exercise_passed"},
    {"id": "weekly_quiz_5", "period": "weekly", "title": "Terminer 5 quiz", "target": 5, "xp": 80, "metric": "quiz_completed"},
    {"id": "weekly_courses_3", "period": "weekly", "title": "Terminer 3 cours", "target": 3, "xp": 90, "metric": "course_completed"},
    {"id": "monthly_learning_10", "period": "monthly", "title": "Terminer 10 chapitres", "target": 10, "xp": 250, "metric": "course_completed"},
    {"id": "quran_pages_future", "period": "daily", "title": "Lire plusieurs pages du Coran", "target": 3, "xp": 30, "metric": "quran_pages", "locked_reason": "Le suivi de lecture page par page n'est pas encore active pour ne pas toucher au lecteur Coran existant."},
]

CHEST_RARITIES = [
    {"rarity": "commun", "weight": 700, "xp": 20, "quiz_bonus": 2},
    {"rarity": "rare", "weight": 220, "xp": 40, "quiz_bonus": 3},
    {"rarity": "epique", "weight": 65, "xp": 70, "quiz_bonus": 5},
    {"rarity": "legendaire", "weight": 13, "xp": 110, "quiz_bonus": 8},
    {"rarity": "ultra_rare", "weight": 2, "xp": 160, "quiz_bonus": 10},
]


def _period_key(period: str) -> str:
    now = datetime.now(timezone.utc)
    if period == "daily":
        return now.strftime("%Y-%m-%d")
    if period == "weekly":
        return f"{now.isocalendar().year}-W{now.isocalendar().week:02d}"
    if period == "monthly":
        return now.strftime("%Y-%m")
    return "all"


async def _gamification_metrics(user: dict) -> dict:
    today = _period_start("today").isoformat()
    week = _period_start("week").isoformat()
    month = _period_start("month").isoformat()
    quiz_daily = await db.quiz_history.count_documents({"user_id": user["id"], "created_at": {"$gte": today}})
    quiz_week = await db.quiz_history.count_documents({"user_id": user["id"], "created_at": {"$gte": week}})
    quiz_month = await db.quiz_history.count_documents({"user_id": user["id"], "created_at": {"$gte": month}})
    multi_daily = await db.multiplayer_history.count_documents({"user_id": user["id"], "played_at": {"$gte": today}})
    multi_week = await db.multiplayer_history.count_documents({"user_id": user["id"], "played_at": {"$gte": week}})
    multi_month = await db.multiplayer_history.count_documents({"user_id": user["id"], "played_at": {"$gte": month}})
    islam_progress = await get_islam_learning_progress(user)
    learn_progress = await get_learn_progress(user)
    completed_courses = len(set(islam_progress.get("completed_topics", [])) | set(learn_progress.get("completed_lessons", [])))
    return {
        "quiz_completed": {"daily": quiz_daily + multi_daily, "weekly": quiz_week + multi_week, "monthly": quiz_month + multi_month},
        "course_completed": {"daily": completed_courses, "weekly": completed_courses, "monthly": completed_courses},
        "exercise_passed": {"daily": int(islam_progress.get("exercises_passed", 0)), "weekly": int(islam_progress.get("exercises_passed", 0)), "monthly": int(islam_progress.get("exercises_passed", 0))},
        "quran_pages": {"daily": 0, "weekly": 0, "monthly": 0},
    }


def _choose_chest_reward() -> dict:
    total = sum(item["weight"] for item in CHEST_RARITIES)
    pick = secrets.randbelow(total)
    current = 0
    for item in CHEST_RARITIES:
        current += item["weight"]
        if pick < current:
            return item
    return CHEST_RARITIES[0]


@api_router.get("/gamification/status")
async def gamification_status(user: dict = Depends(get_current_user)):
    metrics = await _gamification_metrics(user)
    claims = await db.gamification_claims.find({"user_id": user["id"]}, {"_id": 0}).to_list(500)
    claim_keys = {f"{claim['mission_id']}:{claim['period_key']}" for claim in claims}
    missions = []
    for mission in GAMIFICATION_MISSIONS:
        progress = metrics.get(mission["metric"], {}).get(mission["period"], 0)
        period_key = _period_key(mission["period"])
        claimed = f"{mission['id']}:{period_key}" in claim_keys
        missions.append({
            **mission,
            "progress": min(progress, mission["target"]),
            "completed": progress >= mission["target"] and not mission.get("locked_reason"),
            "claimed": claimed,
            "period_key": period_key,
        })
    chests = await db.gamification_chests.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    return {
        "xp": int(user.get("quiz_xp", 0)),
        "level": int(user.get("quiz_level", 1)),
        "missions": missions,
        "chests": chests,
    }


@api_router.post("/gamification/missions/{mission_id}/claim")
async def claim_gamification_mission(mission_id: str, user: dict = Depends(get_current_user)):
    mission = next((item for item in GAMIFICATION_MISSIONS if item["id"] == mission_id), None)
    if not mission or mission.get("locked_reason"):
        raise HTTPException(status_code=404, detail="Mission indisponible.")
    metrics = await _gamification_metrics(user)
    progress = metrics.get(mission["metric"], {}).get(mission["period"], 0)
    if progress < mission["target"]:
        raise HTTPException(status_code=409, detail="Mission pas encore terminee.")
    period_key = _period_key(mission["period"])
    existing = await db.gamification_claims.find_one({"user_id": user["id"], "mission_id": mission_id, "period_key": period_key})
    if existing:
        raise HTTPException(status_code=409, detail="Mission deja recompensee pour cette periode.")

    now = datetime.now(timezone.utc).isoformat()
    old_xp = int(user.get("quiz_xp", 0))
    new_xp = old_xp + int(mission["xp"])
    new_level = max(1, new_xp // 100 + 1)
    await db.users.update_one({"id": user["id"]}, {"$set": {"quiz_xp": new_xp, "quiz_level": new_level}})
    claim = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "mission_id": mission_id,
        "period": mission["period"],
        "period_key": period_key,
        "xp": mission["xp"],
        "created_at": now,
    }
    await db.gamification_claims.insert_one(claim)

    chest = None
    # Chests are intentionally rare: 3% per completed mission.
    if secrets.randbelow(100) < 3:
        chest = {
            "id": str(uuid.uuid4()),
            "user_id": user["id"],
            "source": mission_id,
            "status": "closed",
            "created_at": now,
        }
        await db.gamification_chests.insert_one(chest)
    return {"ok": True, "xp_added": mission["xp"], "xp": new_xp, "level": new_level, "chest": chest}


@api_router.post("/gamification/chests/{chest_id}/open")
async def open_gamification_chest(chest_id: str, user: dict = Depends(get_current_user)):
    chest = await db.gamification_chests.find_one({"id": chest_id, "user_id": user["id"]}, {"_id": 0})
    if not chest:
        raise HTTPException(status_code=404, detail="Coffre introuvable.")
    if chest.get("status") == "opened":
        raise HTTPException(status_code=409, detail="Coffre deja ouvert.")
    reward = _choose_chest_reward()
    now = datetime.now(timezone.utc).isoformat()
    old_xp = int(user.get("quiz_xp", 0))
    new_xp = old_xp + reward["xp"]
    new_level = max(1, new_xp // 100 + 1)
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"quiz_xp": new_xp, "quiz_level": new_level}, "$inc": {"quiz_bonus_points": min(10, reward["quiz_bonus"])}},
    )
    opened = {
        "status": "opened",
        "opened_at": now,
        "rarity": reward["rarity"],
        "xp": reward["xp"],
        "quiz_bonus": min(10, reward["quiz_bonus"]),
        "badge": "Premier coffre" if reward["rarity"] != "ultra_rare" else "Coffre Ultra Rare",
    }
    await db.gamification_chests.update_one({"id": chest_id}, {"$set": opened})
    return {"ok": True, "reward": opened, "xp": new_xp, "level": new_level}


@api_router.post("/multiplayer/questions/report")
async def report_multiplayer_question(data: MultiplayerQuestionReport, user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc).isoformat()
    report = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "user_email": user.get("email"),
        "room_code": (data.room_code or "").strip().upper() or None,
        "question_id": data.question_id,
        "reason": data.reason.strip(),
        "details": (data.details or "").strip(),
        "status": "open",
        "created_at": now,
        "updated_at": now,
    }
    await db.multiplayer_question_reports.insert_one(report)
    return {"ok": True, "report_id": report["id"], "status": report["status"]}


@api_router.post("/multiplayer/rooms/{code}/report-player")
async def report_multiplayer_player(code: str, data: MultiplayerPlayerReport, user: dict = Depends(get_current_user)):
    room = await _room_by_code(code)
    if not room:
        raise HTTPException(status_code=404, detail="Salle introuvable.")
    players = room.get("players", [])
    if not any(player.get("user_id") == user["id"] for player in players):
        raise HTTPException(status_code=403, detail="Vous ne faites pas partie de cette salle.")
    target = next((player for player in players if player.get("user_id") == data.target_user_id), None)
    if not target or target.get("user_id") == user["id"]:
        raise HTTPException(status_code=400, detail="Joueur a signaler invalide.")
    now = datetime.now(timezone.utc).isoformat()
    report = {
        "id": str(uuid.uuid4()),
        "room_code": room["code"],
        "reporter_user_id": user["id"],
        "reporter_email": user.get("email"),
        "target_user_id": target["user_id"],
        "target_name": target.get("name"),
        "reason": data.reason.strip(),
        "details": (data.details or "").strip(),
        "status": "open",
        "created_at": now,
        "updated_at": now,
    }
    await db.multiplayer_player_reports.insert_one(report)
    await _admin_log("player_report", user, target["user_id"], {"room_code": room["code"], "reason": report["reason"]})
    return {"ok": True, "report_id": report["id"], "status": report["status"]}


@api_router.get("/founder-admin/overview")
async def founder_admin_overview(user: dict = Depends(get_current_user)):
    role = await _require_founder_admin(user)
    now = datetime.now(timezone.utc)
    today = _period_start("today").isoformat()
    week = _period_start("week").isoformat()
    month = _period_start("month").isoformat()
    users_total = await db.users.count_documents({})
    connected_rooms = await db.multiplayer_rooms.find(
        {"players.connected": True}, {"_id": 0, "players": 1}
    ).to_list(200)
    connected_ids = set()
    for room in connected_rooms:
        connected_ids.update(player["user_id"] for player in room.get("players", []) if player.get("connected"))
    players_in_game = await db.multiplayer_rooms.count_documents({"status": "playing"})
    subscribers = await db.users.count_documents({"subscription": {"$ne": "free"}})
    question_totals = await db.multiplayer_history.aggregate([
        {"$group": {"_id": None, "correct": {"$sum": "$correct_count"}, "wrong": {"$sum": "$wrong_count"}}}
    ]).to_list(1)
    answered_total = int((question_totals[0].get("correct", 0) + question_totals[0].get("wrong", 0)) if question_totals else 0)
    return {
        "role": role,
        "season": _season_name(now),
        "users_total": users_total,
        "users_connected": len(connected_ids),
        "players_in_game": players_in_game,
        "games_today": await db.multiplayer_history.count_documents({"played_at": {"$gte": today}}),
        "games_week": await db.multiplayer_history.count_documents({"played_at": {"$gte": week}}),
        "games_month": await db.multiplayer_history.count_documents({"played_at": {"$gte": month}}),
        "new_users_today": await db.users.count_documents({"created_at": {"$gte": today}}),
        "subscribers": subscribers,
        "open_reports": (
            await db.multiplayer_question_reports.count_documents({"status": "open"})
            + await db.multiplayer_player_reports.count_documents({"status": "open"})
        ),
        "rewards_total": await db.founder_rewards.count_documents({}),
        "total_quiz": await db.multiplayer_history.count_documents({}),
        "total_questions": answered_total,
    }


@api_router.get("/founder-admin/users")
async def founder_admin_users(search: str = "", limit: int = 50, user: dict = Depends(get_current_user)):
    await _require_founder_admin(user)
    query = {}
    term = search.strip()
    if term:
        query = {"$or": [
            {"name": {"$regex": term, "$options": "i"}},
            {"username": {"$regex": term, "$options": "i"}},
            {"email": {"$regex": term, "$options": "i"}},
            {"id": {"$regex": term, "$options": "i"}},
        ]}
    users = await db.users.find(query, {"_id": 0, "password": 0}).sort("created_at", -1).to_list(max(1, min(limit, 100)))
    user_ids = [item["id"] for item in users]
    history = await db.multiplayer_history.aggregate([
        {"$match": {"user_id": {"$in": user_ids}}},
        {"$group": {"_id": "$user_id", "games": {"$sum": 1}, "wins": {"$sum": {"$cond": ["$won", 1, 0]}}, "correct": {"$sum": "$correct_count"}}}
    ]).to_list(len(user_ids) or 1)
    stats = {item["_id"]: item for item in history}
    connected_rooms = await db.multiplayer_rooms.find({"players.user_id": {"$in": user_ids}}, {"_id": 0, "players": 1, "status": 1}).to_list(200)
    connected = {}
    for room in connected_rooms:
        for player in room.get("players", []):
            if player.get("user_id") in user_ids and player.get("connected"):
                connected[player["user_id"]] = "playing" if room.get("status") == "playing" else "online"
    for item in users:
        item["role"] = _founder_admin_role(item) or "user"
        item["status"] = connected.get(item["id"], "offline")
        item["quiz_games"] = int(stats.get(item["id"], {}).get("games", 0))
        item["quiz_wins"] = int(stats.get(item["id"], {}).get("wins", 0))
        item["quiz_correct"] = int(stats.get(item["id"], {}).get("correct", 0))
    return users


@api_router.get("/founder-admin/users/{target_user_id}")
async def founder_admin_user_detail(target_user_id: str, user: dict = Depends(get_current_user)):
    await _require_founder_admin(user)
    target = await db.users.find_one({"id": target_user_id}, {"_id": 0, "password": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")
    history = await db.multiplayer_history.find({"user_id": target_user_id}, {"_id": 0}).sort("played_at", -1).to_list(100)
    rewards = await db.founder_rewards.find({"target_user_id": target_user_id}, {"_id": 0}).sort("created_at", -1).to_list(50)
    badges = sorted({badge for item in history for badge in item.get("badges_earned", [])})
    target["role"] = _founder_admin_role(target) or "user"
    target["history"] = history
    target["rewards"] = rewards
    target["badges"] = badges
    return target


@api_router.get("/founder-admin/leaderboards")
async def founder_admin_leaderboards(period: str = "all", user: dict = Depends(get_current_user)):
    await _require_founder_admin(user)
    safe_period = period if period in {"today", "week", "month", "year", "all"} else "all"
    return {"period": safe_period, "rows": await _multiplayer_leaderboard(safe_period, 100)}


@api_router.post("/founder-admin/rewards/subscription")
async def founder_admin_gift_subscription(data: FounderSubscriptionGift, user: dict = Depends(get_current_user)):
    role = await _require_founder_admin(user)
    if role not in {"founder", "admin"}:
        raise HTTPException(status_code=403, detail="Permission insuffisante.")
    if data.plan not in {"premium", "pro", "mongo", "developer_elite", "developer_ultimate", "neura_plus", "neura_ultra"}:
        raise HTTPException(status_code=400, detail="Abonnement invalide.")
    target = await db.users.find_one({"id": data.user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable.")
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=31 * data.months)
    await db.users.update_one(
        {"id": data.user_id},
        {"$set": {
            "subscription": data.plan,
            "gifted_subscription": True,
            "gifted_until": expires_at.isoformat(),
            "subscription_updated_at": now.isoformat(),
        }},
    )
    reward = {
        "id": str(uuid.uuid4()),
        "type": "subscription_gift",
        "plan": data.plan,
        "months": data.months,
        "target_user_id": data.user_id,
        "target_email": target.get("email"),
        "actor_id": user.get("id"),
        "actor_email": user.get("email"),
        "reason": (data.reason or "").strip(),
        "expires_at": expires_at.isoformat(),
        "created_at": now.isoformat(),
    }
    await db.founder_rewards.insert_one(reward)
    await db.notifications.insert_one({
        "id": str(uuid.uuid4()),
        "user_id": data.user_id,
        "type": "subscription_gift",
        "title": "Felicitations !",
        "message": "Vous avez recu un abonnement offert par l'equipe de Neura Al Nour.",
        "read": False,
        "created_at": now.isoformat(),
    })
    await _admin_log("subscription_gift", user, data.user_id, {"plan": data.plan, "months": data.months})
    return {"ok": True, "reward": {k: v for k, v in reward.items() if k != "_id"}}


@api_router.get("/founder-admin/rewards")
async def founder_admin_rewards(user: dict = Depends(get_current_user)):
    await _require_founder_admin(user)
    return await db.founder_rewards.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api_router.get("/founder-admin/question-reports")
async def founder_admin_question_reports(user: dict = Depends(get_current_user)):
    await _require_founder_admin(user)
    question_reports = await db.multiplayer_question_reports.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    player_reports = await db.multiplayer_player_reports.find({}, {"_id": 0}).sort("created_at", -1).to_list(100)
    for item in question_reports:
        item["report_type"] = "question"
    for item in player_reports:
        item["report_type"] = "player"
    return sorted(question_reports + player_reports, key=lambda item: item.get("created_at", ""), reverse=True)[:200]


@api_router.get("/founder-admin/logs")
async def founder_admin_logs(user: dict = Depends(get_current_user)):
    await _require_founder_admin(user)
    return await db.founder_admin_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(200)


@api_router.post("/multiplayer/rooms/{code}/reaction")
async def send_multiplayer_reaction(code: str, data: MultiplayerReaction, user: dict = Depends(get_current_user)):
    room = await _room_by_code(code)
    if not room or not any(player.get("user_id") == user["id"] for player in room.get("players", [])):
        raise HTTPException(status_code=403, detail="Vous ne faites pas partie de cette salle.")
    if data.reaction not in MULTIPLAYER_REACTIONS:
        raise HTTPException(status_code=400, detail="Réaction non autorisée.")
    recent = await db.multiplayer_reaction_logs.count_documents({
        "room_code": code.strip().upper(),
        "user_id": user["id"],
        "created_at": {"$gte": (datetime.now(timezone.utc) - timedelta(seconds=5)).isoformat()},
    })
    if recent >= 2:
        raise HTTPException(status_code=429, detail="Trop de reactions en peu de temps.")
    await db.multiplayer_reaction_logs.insert_one({
        "id": str(uuid.uuid4()),
        "room_code": code.strip().upper(),
        "user_id": user["id"],
        "reaction": data.reaction,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await multiplayer_connections.broadcast(code.strip().upper(), {
        "type": "reaction",
        "user_id": user["id"],
        "name": user.get("name") or "Joueur",
        "reaction": data.reaction,
        "label": MULTIPLAYER_REACTIONS[data.reaction],
    })
    return {"status": "sent"}


@api_router.post("/multiplayer/rooms/{code}/leave")
async def leave_multiplayer_room(code: str, user: dict = Depends(get_current_user)):
    room = await _room_by_code(code)
    if not room:
        return {"status": "left"}
    if not any(player.get("user_id") == user["id"] for player in room.get("players", [])):
        raise HTTPException(status_code=403, detail="Vous ne faites pas partie de cette salle.")
    if room.get("status") == "playing":
        now = datetime.now(timezone.utc).isoformat()
        await db.multiplayer_rooms.update_one(
            {"code": room["code"], "players.user_id": user["id"]},
            {"$set": {
                "players.$.connected": False,
                "players.$.ready": False,
                "players.$.abandoned": True,
                "players.$.last_seen": now,
                "updated_at": now,
            }},
        )
        event = multiplayer_round_events.get(room["code"])
        if event:
            updated = await _room_by_code(room["code"])
            active = [p for p in updated.get("players", []) if not p.get("abandoned")]
            answers = updated.get("game", {}).get("round_answers", [])
            if len(answers) >= len(active):
                event.set()
        await _broadcast_room(room["code"], "player_abandoned", user_id=user["id"])
        return {"status": "abandoned"}
    await db.multiplayer_rooms.update_one(
        {"code": room["code"]},
        {"$pull": {"players": {"user_id": user["id"]}},
         "$set": {"status": "waiting", "updated_at": datetime.now(timezone.utc).isoformat()},
         "$unset": {"countdown_id": ""}},
    )
    updated = await _room_by_code(room["code"])
    if not updated or not updated.get("players"):
        await db.multiplayer_rooms.delete_one({"code": room["code"]})
        await _cancel_multiplayer_countdown(room["code"])
        return {"status": "deleted"}
    if updated.get("creator_id") == user["id"]:
        await db.multiplayer_rooms.update_one(
            {"code": room["code"]},
            {"$set": {"creator_id": updated["players"][0]["user_id"]}},
        )
    await _cancel_multiplayer_countdown(room["code"])
    await _broadcast_room(room["code"], "player_left", user_id=user["id"])
    return {"status": "left"}


@api_router.post("/multiplayer/socket-ticket")
async def create_multiplayer_socket_ticket(user: dict = Depends(get_current_user)):
    ticket = secrets.token_urlsafe(32)
    ticket_hash = hashlib.sha256(ticket.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    await db.multiplayer_ws_tickets.insert_one({
        "ticket_hash": ticket_hash,
        "user_id": user["id"],
        "expires_at": (now + timedelta(seconds=60)).isoformat(),
        "created_at": now.isoformat(),
    })
    return {"ticket": ticket, "expires_in": 60}


@api_router.websocket("/multiplayer/ws/{code}")
async def multiplayer_websocket(websocket: WebSocket, code: str, ticket: str):
    normalized_code = code.strip().upper()
    ticket_hash = hashlib.sha256(ticket.encode("utf-8")).hexdigest()
    ticket_doc = await db.multiplayer_ws_tickets.find_one_and_delete(
        {"ticket_hash": ticket_hash}
    )
    if not ticket_doc:
        await websocket.close(code=4401, reason="Ticket invalide")
        return
    try:
        expires_at = datetime.fromisoformat(ticket_doc["expires_at"])
    except (KeyError, ValueError):
        await websocket.close(code=4401, reason="Ticket invalide")
        return
    if expires_at <= datetime.now(timezone.utc):
        await websocket.close(code=4401, reason="Ticket expiré")
        return
    user = await db.users.find_one({"id": ticket_doc["user_id"]}, {"_id": 0})
    room = await _room_by_code(normalized_code)
    if not user or not room or not any(
        player.get("user_id") == user["id"] for player in room.get("players", [])
    ):
        await websocket.close(code=4403, reason="Accès refusé")
        return

    await multiplayer_connections.connect(normalized_code, user["id"], websocket)
    now = datetime.now(timezone.utc).isoformat()
    await db.multiplayer_rooms.update_one(
        {"code": normalized_code, "players.user_id": user["id"]},
        {"$set": {
            "players.$.connected": True,
            "players.$.last_seen": now,
            "updated_at": now,
        }},
    )
    await _broadcast_room(normalized_code, "presence_changed", user_id=user["id"])

    try:
        while True:
            payload = await websocket.receive_json()
            if payload.get("type") == "ping":
                await websocket.send_json({"type": "pong", "sent_at": payload.get("sent_at")})
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        last_connection = await multiplayer_connections.disconnect(
            normalized_code, user["id"], websocket
        )
        if last_connection:
            now = datetime.now(timezone.utc).isoformat()
            current_room = await _room_by_code(normalized_code)
            if current_room and current_room.get("status") == "playing":
                await db.multiplayer_rooms.update_one(
                    {"code": normalized_code, "players.user_id": user["id"]},
                    {"$set": {
                        "players.$.connected": False,
                        "players.$.last_seen": now,
                        "updated_at": now,
                    }},
                )
            else:
                await db.multiplayer_rooms.update_one(
                    {"code": normalized_code, "players.user_id": user["id"]},
                    {"$set": {
                        "players.$.connected": False,
                        "players.$.ready": False,
                        "players.$.last_seen": now,
                        "status": "waiting",
                        "updated_at": now,
                    }, "$unset": {"countdown_id": ""}},
                )
                await _cancel_multiplayer_countdown(normalized_code)
            await _broadcast_room(normalized_code, "presence_changed", user_id=user["id"])

# ============== RAMADAN ==============

@api_router.get("/ramadan/times")
async def get_ramadan_times(latitude: float, longitude: float):
    """Get Suhoor and Iftar times"""
    prayer_times = await get_prayer_times(latitude, longitude)
    return {
        "suhoor": prayer_times["fajr"],
        "iftar": prayer_times["maghrib"],
        "fajr": prayer_times["fajr"],
        "date": prayer_times["date"]
    }

@api_router.get("/ramadan/tips")
async def get_ramadan_tips():
    """Get Ramadan tips and advice"""
    return [
        {
            "id": "tip1",
            "title": "Le Suhoor",
            "content": "Ne sautez jamais le Suhoor (repas avant l'aube). Le Prophète ﷺ a dit: 'Prenez le Suhoor car il y a de la bénédiction dans le Suhoor.'"
        },
        {
            "id": "tip2",
            "title": "Rompre le jeûne",
            "content": "Il est recommandé de rompre le jeûne avec des dattes et de l'eau, comme le faisait le Prophète ﷺ."
        },
        {
            "id": "tip3",
            "title": "Ce qui annule le jeûne",
            "content": "Manger ou boire intentionnellement, les relations intimes, et les vomissements volontaires annulent le jeûne."
        },
        {
            "id": "tip4",
            "title": "Oubli de manger",
            "content": "Si vous mangez ou buvez par oubli, votre jeûne reste valide. Continuez simplement à jeûner."
        },
        {
            "id": "tip5",
            "title": "La prière de Tarawih",
            "content": "Les prières de Tarawih sont fortement recommandées pendant le Ramadan. Elles se font après la prière de l'Isha."
        }
    ]

# ============== EID ==============

@api_router.get("/eid/info")
async def get_eid_info(eid_type: str = "fitr"):
    """Get Eid information"""
    if eid_type == "fitr":
        return {
            "name": "Aïd al-Fitr",
            "arabic": "عيد الفطر",
            "description": "L'Aïd al-Fitr marque la fin du mois de Ramadan. C'est une fête de joie et de gratitude.",
            "practices": [
                "Payer la Zakat al-Fitr avant la prière de l'Aïd",
                "Faire la prière de l'Aïd en congrégation",
                "Dire les Takbirs",
                "Rendre visite à la famille et aux amis",
                "Offrir des cadeaux aux enfants"
            ],
            "zakat_fitr": "La Zakat al-Fitr est obligatoire pour chaque musulman. Elle doit être payée avant la prière de l'Aïd."
        }
    else:
        return {
            "name": "Aïd al-Adha",
            "arabic": "عيد الأضحى",
            "description": "L'Aïd al-Adha commémore le sacrifice d'Ibrahim (Abraham). C'est la plus grande fête islamique.",
            "practices": [
                "Faire la prière de l'Aïd en congrégation",
                "Sacrifier un animal (pour ceux qui en ont les moyens)",
                "Partager la viande avec les pauvres et la famille",
                "Dire les Takbirs pendant les jours de Tashreeq"
            ],
            "sacrifice": "Le sacrifice est une Sunnah confirmée pour ceux qui en ont les moyens financiers."
        }

# ============== DEVELOPER AI ENDPOINTS ==============

class DevMessageCreate(BaseModel):
    content: str
    session_id: Optional[str] = None
    image_base64: Optional[str] = None
    web_search: Optional[bool] = False
    role: Optional[str] = None


# Expert roles the AI can take (Neura+/Ultra). Lets the user pick a "senior" specialist.
DEV_ROLES = {
    "frontend": "Développeur Frontend senior",
    "backend": "Développeur Backend senior",
    "fullstack": "Développeur Fullstack senior",
    "architect": "Architecte logiciel",
    "security": "Expert en sécurité applicative",
    "database": "Expert base de données",
    "mobile": "Développeur mobile senior",
}


def _build_dev_system_prompt(tier_name: str) -> str:
    tier = DEV_TIERS[tier_name]
    base = (
        "Tu es NEURA DEV, un assistant développeur senior intégré à l'application "
        "NEURA AL-NOUR. Tu te comportes comme un vrai développeur professionnel "
        "(esprit Claude Code / Cursor), pas comme un simple générateur de snippets.\n"
        "RESPECT ABSOLU : NEURA AL-NOUR est une application à vocation islamique. Tu restes "
        "TOUJOURS respectueux, poli et bienveillant. Tu n'insultes JAMAIS, aucune vulgarité, "
        "aucun contenu offensant, choquant ou inapproprié — même si l'utilisateur te provoque "
        "ou est grossier : tu recadres poliment et tu restes courtois.\n\n"
        "MÉTHODE (à suivre rigoureusement) :\n"
        "1. CADRAGE AVANT DE CODER. Pour toute demande de projet, de fonctionnalité ou de script "
        "un peu conséquent (serveur/script FiveM, pack d'armes/véhicules, SaaS, app, API, bot...), "
        "NE génère PAS de code immédiatement. Pose d'abord une vraie BATTERIE de questions "
        "pertinentes — au moins 4 à 8, JAMAIS une seule — regroupées et numérotées, couvrant selon "
        "le cas : l'objectif précis, le périmètre exact (inclus / exclu), la stack et sa VERSION, "
        "le framework, les données / base de données, l'inventaire et l'économie (FiveM), les "
        "dépendances et scripts déjà installés, les contraintes (performance, sécurité, nombre de "
        "joueurs/utilisateurs), l'UI attendue (NUI / commandes), et les intégrations existantes. "
        "Pose des questions UTILES et SPÉCIFIQUES au domaine réel de la demande, pas génériques.\n"
        "2. Quand tu as assez d'infos (ou si la demande est vraiment simple et sans ambiguïté), "
        "donne : un PLAN clair, la liste des fichiers concernés (chemin EXACT), puis le code.\n"
        "3. ÉTAPE PAR ÉTAPE pour les gros projets : propose un découpage, livre une première "
        "partie cohérente et fonctionnelle, puis annonce explicitement l'étape suivante. Ne "
        "prétends jamais avoir tout fait si ce n'est pas le cas.\n"
        "4. Pour CHAQUE fichier, écris une ligne 'Fichier: <chemin/exact>' puis un bloc de code "
        "balisé avec le langage. Exemple :\nFichier: frontend/src/pages/Example.jsx\n"
        "```jsx\n// code complet ici\n```\n"
        "5. Code RÉEL, fonctionnel, cohérent, prêt à coller. Jamais de pseudo-code inutile, jamais "
        "de fichiers/fonctions inventés sans le dire : si un fichier n'existe pas encore, signale-le "
        "(\"Ce fichier n'existe pas encore, je propose de le créer\").\n"
        "6. Sécurité : ne mets jamais en dur ni n'affiche de secrets (clés API, tokens, mots de "
        "passe, .env). Masque-les. Préviens avant toute action risquée (suppression, migration "
        "DB, changement d'auth/Stripe/permissions).\n"
        "7. Reste précis et professionnel : pas de remplissage, pas de réponses vagues. Si tu "
        "n'es pas sûr, dis-le et propose la meilleure approche. Ne casse pas l'existant : explique "
        "l'impact de chaque modification.\n"
    )
    if not tier["project_analysis"]:
        limits = (
            f"\nABONNEMENT : {tier['label']} (limité). Garde un périmètre PETIT : au maximum "
            f"{tier['max_files']} fichier(s) par réponse, réponses concises. Pour un gros projet, "
            "génère SEULEMENT une première partie fonctionnelle puis indique clairement la suite à "
            "demander (l'utilisateur pourra continuer ou passer à Neura+ / Neura Ultra)."
        )
    else:
        limits = (
            f"\nABONNEMENT : {tier['label']} (avancé). Analyse approfondie autorisée, génération "
            f"multi-fichiers jusqu'à {tier['max_files']} fichiers par réponse, plans détaillés, "
            "architecture frontend + backend + base de données."
        )
    return base + limits + MODERATION_GUARD + IDENTITY_GUARD


async def _dev_quota_state(user: dict):
    """Return (tier_name, tier, used, reset_at_iso, window_start) with window reset applied."""
    tier_name = get_dev_tier(user)
    tier = DEV_TIERS[tier_name]
    now = datetime.now(timezone.utc)
    window = timedelta(hours=tier["window_hours"])
    doc = await db.dev_quota.find_one({"user_id": user["id"]}, {"_id": 0})
    if doc:
        window_start = datetime.fromisoformat(doc["window_start"])
        if now - window_start >= window:
            used, window_start = 0, now
        else:
            used = int(doc.get("used", 0))
    else:
        used, window_start = 0, now
    reset_at = (window_start + window).isoformat()
    return tier_name, tier, used, reset_at, window_start


@api_router.post("/developer/chat")
async def developer_chat(message: DevMessageCreate, user: dict = Depends(get_current_user)):
    """Developer AI assistant. Real Gemini-backed code generation with per-tier
    quota (requests / response size / files / memory) and project memory."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    tier_name, tier, used, reset_at, window_start = await _dev_quota_state(user)
    unlimited = _dev_is_unlimited(user)

    # Enforce quota (founders/VIP are never blocked)
    if not unlimited and used >= tier["requests"]:
        raise HTTPException(status_code=429, detail={
            "message": (
                "Tu as atteint la limite de génération de code de ton abonnement actuel. "
                "Tu peux attendre la prochaine régénération de crédits ou passer à "
                "Neura+ / Neura Ultra pour continuer sans attendre avec plus de puissance, "
                "plus de mémoire et plus de génération."
            ),
            "quota": {"tier": tier_name, "limit": tier["requests"], "used": used,
                      "remaining": 0, "reset_at": reset_at, "window_hours": tier["window_hours"]},
        })

    session_id = message.session_id or str(uuid.uuid4())

    # Project memory: recent turns of this developer session (bounded by tier)
    history = await db.dev_messages.find(
        {"session_id": session_id, "user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(tier["memory_turns"])

    system_prompt = _build_dev_system_prompt(tier_name) + current_ai_context()
    # Expert role (Neura+/Ultra only) — adopt a senior specialist persona.
    if message.role in DEV_ROLES and tier_name in ("plus", "ultra"):
        system_prompt += (
            f"\n\nRÔLE ACTIF : Tu interviens en tant que {DEV_ROLES[message.role]}. "
            "Adopte l'expertise, le vocabulaire, les priorités et les bonnes pratiques de ce rôle."
        )
    # Project analysis: give premium users' workspace files to the model as context.
    if _is_premium_ai(user):
        wf = await db.dev_files.find({"user_id": user["id"]}, {"_id": 0}).sort("path", 1).to_list(40)
        if wf:
            ctx = "\n\n=== PROJET ACTUEL DE L'UTILISATEUR (analyse ces fichiers, tiens-en compte) ===\n"
            for f in wf:
                c = f.get("content", "")
                if len(c) > 4000:
                    c = c[:4000] + "\n... (tronqué)"
                ctx += f"\nFichier: {f['path']}\n```\n{c}\n```\n"
            system_prompt += ctx
    initial_messages = [{"role": "system", "content": system_prompt}]
    for m in history:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            initial_messages.append({"role": m["role"], "content": m["content"]})

    # Save the user request first (so memory persists even across the regeneration delay)
    now_iso = datetime.now(timezone.utc).isoformat()
    await db.dev_messages.insert_one({
        "id": str(uuid.uuid4()), "session_id": session_id, "user_id": user["id"],
        "role": "user", "content": message.content, "created_at": now_iso,
    })

    # Optional web search (Tavily) -> prepend results as context for the code task.
    sources = []
    user_text = message.content
    if message.web_search:
        try:
            sources = await tavily_search(message.content, max_results=5)
        except Exception as e:
            logger.error(f"Tavily (dev) error: {e}")
            sources = []
        system_prompt += web_results_context(sources)
        initial_messages[0]["content"] = system_prompt

    # Build the user message (with optional image for screenshot / code analysis).
    if message.image_base64:
        from emergentintegrations.llm.chat import FileContent
        image_data = message.image_base64
        if image_data.startswith("data:"):
            parts = image_data.split(",", 1)
            image_data = parts[1] if len(parts) > 1 else image_data
        user_msg_obj = UserMessage(
            text=user_text or "Analyse cette image (capture d'écran / code).",
            file_contents=[FileContent(content_type="image", file_content_base64=image_data)],
        )
    else:
        user_msg_obj = UserMessage(text=user_text)

    # Code model by tier: premium (Neura+/Ultra) -> Claude Sonnet (best for code);
    # free stays on Gemini for cost. Images stay on Gemini (vision proven).
    if tier_name in ("plus", "ultra") and not message.image_base64:
        dev_provider, dev_model = "anthropic", "claude-sonnet-4-5"
    else:
        dev_provider, dev_model = "gemini", "gemini-2.5-flash"

    response = None
    last_err = None
    for attempt in range(3):
        try:
            chat = LlmChat(
                api_key=AI_LLM_KEY,
                session_id=f"dev_{session_id}",
                system_message=system_prompt,
                initial_messages=initial_messages,
            ).with_model(dev_provider, dev_model).with_params(
                max_tokens=tier["max_tokens"], temperature=0.3
            )
            response = await chat.send_message(user_msg_obj)
            last_err = None
            break
        except Exception as e:
            last_err = e
            es = str(e)
            transient = ("429" in es or "503" in es or "RESOURCE_EXHAUSTED" in es
                         or "UNAVAILABLE" in es or "rate" in es.lower())
            if transient and attempt < 2:
                await asyncio.sleep(2 + attempt * 3)
                continue
            break

    if last_err is not None:
        es = str(last_err)
        logger.error(f"Developer chat error: {es[:300]}")
        quota_info = {"tier": tier_name, "limit": tier["requests"], "used": used,
                      "remaining": (None if unlimited else max(0, tier["requests"] - used)),
                      "reset_at": reset_at, "window_hours": tier["window_hours"], "unlimited": unlimited}
        if any(x in es for x in ("RESOURCE_EXHAUSTED", "PerDay", "PerMinute", "quota", "429")):
            # Gemini free-tier limit reached (shared across the whole app, not a per-plan limit)
            raise HTTPException(status_code=429, detail={
                "message": (
                    "Le quota gratuit de l'IA (Gemini) est temporairement atteint — c'est une limite "
                    "du palier gratuit, partagée par toute l'application (≈ quelques requêtes/minute et "
                    "un plafond par jour). Réessaie dans quelques minutes, ou plus tard. "
                    "Astuce : une clé API Gemini standard augmente fortement cette limite, gratuitement."
                ),
                "quota": quota_info,
            })
        raise HTTPException(status_code=503, detail="Service IA développeur temporairement indisponible. Réessaie.")

    await db.dev_messages.insert_one({
        "id": str(uuid.uuid4()), "session_id": session_id, "user_id": user["id"],
        "role": "assistant", "content": response, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.dev_sessions.update_one(
        {"session_id": session_id, "user_id": user["id"]},
        {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
         "$setOnInsert": {"session_id": session_id, "user_id": user["id"],
                          "title": message.content[:60], "created_at": now_iso}},
        upsert=True,
    )

    # Consume one unit of quota (track usage for everyone; only block non-unlimited)
    await db.dev_quota.update_one(
        {"user_id": user["id"]},
        {"$set": {"user_id": user["id"], "used": used + 1, "window_start": window_start.isoformat()}},
        upsert=True,
    )

    return {
        "response": response,
        "session_id": session_id,
        "sources": sources,
        "quota": {"tier": tier_name, "limit": tier["requests"], "used": used + 1,
                  "remaining": (None if unlimited else max(0, tier["requests"] - used - 1)),
                  "reset_at": reset_at, "window_hours": tier["window_hours"], "unlimited": unlimited},
    }


@api_router.get("/developer/status")
async def developer_status(user: dict = Depends(get_current_user)):
    tier_name, tier, used, reset_at, _ = await _dev_quota_state(user)
    unlimited = _dev_is_unlimited(user)
    return {
        "tier": tier_name,
        "label": tier["label"],
        "is_founder": bool(user.get("is_vip") or is_vip_email(user.get("email"))),
        "limit": tier["requests"],
        "used": used,
        "remaining": (None if unlimited else max(0, tier["requests"] - used)),
        "unlimited": unlimited,
        "window_hours": tier["window_hours"],
        "reset_at": reset_at,
        "max_files": tier["max_files"],
        "max_tokens": tier["max_tokens"],
        "project_analysis": tier["project_analysis"],
    }


@api_router.get("/developer/history")
async def developer_history(user: dict = Depends(get_current_user)):
    sessions = await db.dev_sessions.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("updated_at", -1).to_list(50)
    return sessions


@api_router.get("/developer/session/{session_id}")
async def developer_session_messages(session_id: str, user: dict = Depends(get_current_user)):
    msgs = await db.dev_messages.find(
        {"session_id": session_id, "user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(400)
    return msgs


# ============== DEVELOPER WORKSPACE (premium: files, versions, rollback, diff, syntax) ==============
# Safe "agent" features on a web app: files live in the DB per-user (never the server FS),
# and nothing is ever executed (syntax check is a static parse only).

class DevFile(BaseModel):
    path: str
    content: str

class DevRollbackReq(BaseModel):
    path: str
    version_id: str

class DevDiffReq(BaseModel):
    path: str
    new_content: str

class DevSyntaxReq(BaseModel):
    path: str
    content: str


def _require_dev_workspace(user: dict):
    """The workspace (apply / rollback / files) is a Neura+ / Ultra feature."""
    if not _is_premium_ai(user):
        raise HTTPException(status_code=403, detail={
            "message": "L'espace de travail développeur (fichiers, application du code, "
                       "rollback, diff) est réservé à Neura+ / Neura Ultra.",
            "upgrade": True,
        })


@api_router.get("/developer/files")
async def dev_files_list(user: dict = Depends(get_current_user)):
    _require_dev_workspace(user)
    return await db.dev_files.find(
        {"user_id": user["id"]}, {"_id": 0, "content": 0}
    ).sort("path", 1).to_list(500)


@api_router.get("/developer/files/content")
async def dev_file_get(path: str, user: dict = Depends(get_current_user)):
    _require_dev_workspace(user)
    f = await db.dev_files.find_one({"user_id": user["id"], "path": path}, {"_id": 0})
    if not f:
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    return f


@api_router.post("/developer/files")
async def dev_file_save(file: DevFile, user: dict = Depends(get_current_user)):
    """Create/overwrite a file. The previous content is auto-saved to history (rollback)."""
    _require_dev_workspace(user)
    now = datetime.now(timezone.utc).isoformat()
    existing = await db.dev_files.find_one({"user_id": user["id"], "path": file.path}, {"_id": 0})
    if existing and existing.get("content") != file.content:
        await db.dev_file_history.insert_one({
            "id": str(uuid.uuid4()), "user_id": user["id"], "path": file.path,
            "content": existing["content"], "saved_at": now,
        })
    await db.dev_files.update_one(
        {"user_id": user["id"], "path": file.path},
        {"$set": {"user_id": user["id"], "path": file.path, "content": file.content, "updated_at": now}},
        upsert=True,
    )
    return {"ok": True, "path": file.path, "updated_at": now}


@api_router.delete("/developer/files")
async def dev_file_delete(path: str, user: dict = Depends(get_current_user)):
    _require_dev_workspace(user)
    existing = await db.dev_files.find_one({"user_id": user["id"], "path": path}, {"_id": 0})
    if existing:
        await db.dev_file_history.insert_one({
            "id": str(uuid.uuid4()), "user_id": user["id"], "path": path,
            "content": existing["content"], "saved_at": datetime.now(timezone.utc).isoformat(),
        })
    await db.dev_files.delete_one({"user_id": user["id"], "path": path})
    return {"ok": True}


@api_router.get("/developer/files/history")
async def dev_file_history(path: str, user: dict = Depends(get_current_user)):
    _require_dev_workspace(user)
    return await db.dev_file_history.find(
        {"user_id": user["id"], "path": path}, {"_id": 0}
    ).sort("saved_at", -1).to_list(50)


@api_router.post("/developer/files/rollback")
async def dev_file_rollback(req: DevRollbackReq, user: dict = Depends(get_current_user)):
    """Restore a previous version (the current content is first saved to history)."""
    _require_dev_workspace(user)
    ver = await db.dev_file_history.find_one(
        {"user_id": user["id"], "path": req.path, "id": req.version_id}, {"_id": 0})
    if not ver:
        raise HTTPException(status_code=404, detail="Version introuvable")
    now = datetime.now(timezone.utc).isoformat()
    cur = await db.dev_files.find_one({"user_id": user["id"], "path": req.path}, {"_id": 0})
    if cur:
        await db.dev_file_history.insert_one({
            "id": str(uuid.uuid4()), "user_id": user["id"], "path": req.path,
            "content": cur["content"], "saved_at": now,
        })
    await db.dev_files.update_one(
        {"user_id": user["id"], "path": req.path},
        {"$set": {"content": ver["content"], "updated_at": now}}, upsert=True,
    )
    return {"ok": True, "restored_from": ver["saved_at"]}


@api_router.post("/developer/files/diff")
async def dev_file_diff(req: DevDiffReq, user: dict = Depends(get_current_user)):
    """Unified diff between the stored file and a proposed new content (before applying)."""
    _require_dev_workspace(user)
    import difflib
    cur = await db.dev_files.find_one({"user_id": user["id"], "path": req.path}, {"_id": 0})
    old = cur["content"] if cur else ""
    diff_lines = list(difflib.unified_diff(
        old.splitlines(), req.new_content.splitlines(),
        fromfile=f"a/{req.path}", tofile=f"b/{req.path}", lineterm=""))
    added = sum(1 for l in diff_lines if l.startswith("+") and not l.startswith("+++"))
    removed = sum(1 for l in diff_lines if l.startswith("-") and not l.startswith("---"))
    return {"path": req.path, "diff": "\n".join(diff_lines),
            "added": added, "removed": removed, "is_new": cur is None}


@api_router.post("/developer/syntax-check")
async def dev_syntax_check(req: DevSyntaxReq, user: dict = Depends(get_current_user)):
    """Static syntax validation only (NEVER executes code)."""
    _require_dev_workspace(user)
    p = req.path.lower()
    if p.endswith(".py"):
        import ast
        try:
            ast.parse(req.content)
            return {"ok": True, "language": "python", "message": "Syntaxe Python valide ✅"}
        except SyntaxError as e:
            return {"ok": False, "language": "python",
                    "message": f"Erreur de syntaxe ligne {e.lineno}: {e.msg}"}
    if p.endswith(".json"):
        import json as _json
        try:
            _json.loads(req.content)
            return {"ok": True, "language": "json", "message": "JSON valide ✅"}
        except Exception as e:
            return {"ok": False, "language": "json", "message": f"JSON invalide: {str(e)[:100]}"}
    return {"ok": True, "language": "n/a",
            "message": "Vérif syntaxique automatique dispo pour .py et .json (sans exécution)."}


# ============== LANGUAGE TUTOR (AI private teacher, all languages) ==============

class LangTutorMessage(BaseModel):
    content: str
    language: str = "English"   # language NAME to learn (drives the AI)
    level: Optional[str] = "débutant"
    session_id: Optional[str] = None
    voice: Optional[bool] = False  # true if the message came from speech


@api_router.post("/language-tutor/chat")
async def language_tutor(message: LangTutorMessage, user: dict = Depends(get_current_user)):
    """AI private language tutor. Teaches in the chosen language, adapts to level,
    corrects grammar/vocab/phrasing, gives exercises/quizzes, keeps a real conversation."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    session_id = message.session_id or str(uuid.uuid4())
    level = message.level or "débutant"
    lang = message.language or "English"
    voice_instruction = (
        "Le message vient d'une transcription vocale qui peut contenir une erreur de reconnaissance. "
        "Déduis le sens grâce au contexte ; si un mot paraît incohérent, pose une courte question de "
        "clarification au lieu de corriger une erreur probablement créée par la transcription. "
        "Réponds avec des phrases courtes et naturelles, faciles à écouter. Donne une prononciation "
        "simple et utile, sans prétendre avoir analysé directement le son ou l'accent.\n"
        if message.voice else "Le message a été écrit par l'élève.\n"
    )

    system = (
        f"Tu es un PROFESSEUR PARTICULIER de langue, patient, bienveillant et motivant, "
        f"qui enseigne le **{lang}** à un élève de niveau **{level}**.\n"
        f"- Parle PRINCIPALEMENT en {lang} (immersion), mais explique/aide en français quand l'élève bloque "
        "ou ne comprend pas (surtout pour les débutants).\n"
        "- Corrige avec douceur ses fautes de grammaire, de conjugaison, de vocabulaire et de formulation. "
        "Montre la version correcte, puis explique brièvement pourquoi.\n"
        f"- {voice_instruction}"
        "- Enseigne des EXPRESSIONS de la vraie vie, pas des traductions mot à mot.\n"
        "- Adapte la difficulté au niveau (débutant = phrases simples + plus de français ; avancé = "
        f"presque tout en {lang}).\n"
        "- Réponds aux demandes : « corrige-moi », « donne-moi des exercices », « fais-moi un quiz », "
        "« explique cette phrase », « fais-moi parler davantage ».\n"
        "- Garde la conversation VIVANTE : termine souvent par une petite question pour faire parler l'élève. "
        "Sois encourageant et concret. Reste respectueux (application à vocation islamique)."
    )

    history = await db.lang_messages.find(
        {"session_id": session_id, "user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(40)
    initial = [{"role": "system", "content": system}]
    for m in history:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            initial.append({"role": m["role"], "content": m["content"]})

    now = datetime.now(timezone.utc).isoformat()
    await db.lang_messages.insert_one({
        "id": str(uuid.uuid4()), "session_id": session_id, "user_id": user["id"],
        "role": "user", "content": message.content, "language": lang,
        "voice": bool(message.voice), "created_at": now,
    })

    provider, model = ("openai", "gpt-4o") if _is_premium_ai(user) else ("gemini", "gemini-2.5-flash")
    response, last_err = None, None
    for attempt in range(3):
        try:
            chat = LlmChat(api_key=AI_LLM_KEY, session_id=f"lang_{session_id}",
                           system_message=system, initial_messages=initial
                           ).with_model(provider, model).with_params(max_tokens=1024, temperature=0.6)
            response = await chat.send_message(UserMessage(text=message.content))
            last_err = None
            break
        except Exception as e:
            last_err = e
            es = str(e)
            if any(x in es for x in ("429", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE")) and attempt < 2:
                await asyncio.sleep(2 + attempt * 3)
                continue
            break
    if last_err is not None:
        logger.error(f"Language tutor error: {str(last_err)[:200]}")
        raise HTTPException(status_code=503, detail="Service IA temporairement indisponible. Réessaie.")

    await db.lang_messages.insert_one({
        "id": str(uuid.uuid4()), "session_id": session_id, "user_id": user["id"],
        "role": "assistant", "content": response, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.lang_progress.update_one(
        {"user_id": user["id"], "language": lang},
        {"$set": {"level": level, "updated_at": now},
         "$setOnInsert": {"user_id": user["id"], "language": lang, "created_at": now}},
        upsert=True,
    )
    return {"response": response, "session_id": session_id}


@api_router.post("/language-tutor/stream")
async def language_tutor_stream(message: LangTutorMessage, user: dict = Depends(get_current_user)):
    """Stream the language tutor response so the first words reach the UI immediately."""

    def sse(payload: dict) -> str:
        return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    async def event_generator():
        from emergentintegrations.llm.chat import LlmChat, UserMessage

        session_id = message.session_id or str(uuid.uuid4())
        level = message.level or "débutant"
        lang = message.language or "English"
        voice_instruction = (
            "Le message vient d'une transcription vocale qui peut contenir une erreur de reconnaissance. "
            "Déduis le sens grâce au contexte ; si un mot paraît incohérent, pose une courte question de "
            "clarification au lieu de corriger une erreur probablement créée par la transcription. "
            "Réponds avec des phrases courtes et naturelles, faciles à écouter. Donne une prononciation "
            "simple et utile, sans prétendre avoir analysé directement le son ou l'accent.\n"
            if message.voice else "Le message a été écrit par l'élève.\n"
        )
        system = (
            "Tu es un PROFESSEUR PARTICULIER de langue, patient, bienveillant et motivant, "
            f"qui enseigne le **{lang}** à un élève de niveau **{level}**.\n"
            f"- Parle PRINCIPALEMENT en {lang} (immersion), mais explique/aide en français quand "
            "l'élève bloque ou ne comprend pas (surtout pour les débutants).\n"
            "- Corrige avec douceur ses fautes de grammaire, de conjugaison, de vocabulaire et de "
            "formulation. Montre la version correcte, puis explique brièvement pourquoi.\n"
            f"- {voice_instruction}"
            "- Enseigne des EXPRESSIONS de la vraie vie, pas des traductions mot à mot.\n"
            "- Adapte la difficulté au niveau et garde la conversation vivante.\n"
            "- Réponds aux demandes de correction, exercices, quiz et explications.\n"
            "- Termine souvent par une petite question. Reste respectueux et concret."
        )

        try:
            history = await db.lang_messages.find(
                {"session_id": session_id, "user_id": user["id"]}, {"_id": 0}
            ).sort("created_at", 1).to_list(40)
            initial = [{"role": "system", "content": system}]
            for item in history:
                if item.get("role") in ("user", "assistant") and item.get("content"):
                    initial.append({"role": item["role"], "content": item["content"]})

            now = datetime.now(timezone.utc).isoformat()
            await db.lang_messages.insert_one({
                "id": str(uuid.uuid4()), "session_id": session_id, "user_id": user["id"],
                "role": "user", "content": message.content, "language": lang,
                "voice": bool(message.voice), "created_at": now,
            })
            yield sse({"type": "session", "session_id": session_id})

            provider, model = (
                ("openai", "gpt-4o") if _is_premium_ai(user)
                else ("gemini", "gemini-2.5-flash")
            )
            answer = ""
            last_error = None
            for attempt in range(3):
                try:
                    chat = LlmChat(
                        api_key=AI_LLM_KEY,
                        session_id=f"lang_stream_{session_id}",
                        system_message=system,
                        initial_messages=initial,
                    ).with_model(provider, model).with_params(max_tokens=1024, temperature=0.6)
                    async for event in chat.stream_message(UserMessage(text=message.content)):
                        incoming = getattr(event, "content", None)
                        if incoming:
                            # Providers may emit token deltas, cumulative text, or a final
                            # duplicate of the complete answer. Normalize all three forms.
                            if incoming.startswith(answer):
                                delta = incoming[len(answer):]
                                answer = incoming
                            elif answer.endswith(incoming):
                                delta = ""
                            else:
                                delta = incoming
                                answer += incoming
                            if delta:
                                yield sse({"type": "delta", "content": delta})
                    last_error = None
                    break
                except Exception as exc:
                    last_error = exc
                    transient = any(token in str(exc) for token in (
                        "429", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE"
                    ))
                    if transient and not answer and attempt < 2:
                        await asyncio.sleep(2 + attempt * 3)
                        continue
                    break

            if last_error is not None:
                raise last_error

            await db.lang_messages.insert_one({
                "id": str(uuid.uuid4()), "session_id": session_id, "user_id": user["id"],
                "role": "assistant", "content": answer,
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
            await db.lang_progress.update_one(
                {"user_id": user["id"], "language": lang},
                {"$set": {"level": level, "updated_at": now},
                 "$setOnInsert": {"user_id": user["id"], "language": lang, "created_at": now}},
                upsert=True,
            )
            yield sse({"type": "done", "session_id": session_id})
        except Exception as exc:
            logger.error("Language tutor stream error: %s", str(exc)[:200])
            yield sse({"type": "error", "detail": "Service IA temporairement indisponible. Réessaie."})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api_router.get("/language-tutor/progress")
async def language_tutor_progress(user: dict = Depends(get_current_user)):
    return await db.lang_progress.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("updated_at", -1).to_list(200)


# ============== ISLAM LEARNING (cautious AI teacher) ==============

ISLAM_ACADEMY_CHAPTERS = [
    {"id": "decouvrir-islam", "level": 1, "title": "Decouvrir l'Islam", "summary": "Les bases, le sens de l'adoration et les objectifs du parcours.", "source_note": "Bases generales appuyees par le Coran et la Sunna authentique."},
    {"id": "cinq-piliers", "level": 2, "title": "Les cinq piliers", "summary": "Chahada, priere, zakat, jeune de Ramadan et hajj.", "source_note": "Hadith des cinq piliers rapporte par Al-Bukhari et Muslim."},
    {"id": "six-piliers-foi", "level": 3, "title": "Les six piliers de la foi", "summary": "Foi en Allah, Ses anges, Ses livres, Ses messagers, le Jour dernier et le destin.", "source_note": "Hadith de Jibril rapporte par Muslim."},
    {"id": "purification", "level": 4, "title": "La purification", "summary": "Ablutions, proprete, intention et preparation a la priere.", "source_note": "Coran 5:6 et hadiths authentiques."},
    {"id": "priere", "level": 5, "title": "La priere", "summary": "Importance, horaires, conditions, gestes et concentration.", "source_note": "Coran 4:103 et hadiths authentiques sur la salat."},
    {"id": "jeune", "level": 6, "title": "Le jeune", "summary": "Ramadan, intention, adab, dispenses et objectifs spirituels.", "source_note": "Coran 2:183-185."},
    {"id": "zakat", "level": 7, "title": "La Zakat", "summary": "Sens, responsabilite sociale et grandes categories.", "source_note": "Coran 9:60 pour les categories."},
    {"id": "hajj", "level": 8, "title": "Le Hajj", "summary": "Sens du pelerinage, etapes principales et adab.", "source_note": "Coran 3:97 et traditions authentiques."},
    {"id": "coran", "level": 9, "title": "Le Coran", "summary": "Respect du texte, lecture, comprehension et memorisation progressive.", "source_note": "Le lecteur Coran existant reste la source de lecture."},
    {"id": "invocations", "level": 10, "title": "Les invocations", "summary": "Duas et adhkar du quotidien avec prudence sur les formulations.", "source_note": "Duas authentiques selon les recueils reconnus."},
    {"id": "prophetes", "level": 11, "title": "Les Prophetes", "summary": "Leurs histoires, leur patience et leurs enseignements.", "source_note": "Recits coraniques authentiques."},
    {"id": "prophete-muhammad", "level": 12, "title": "Le Prophete Muhammad", "summary": "Biographie, mission, misericorde et exemple moral.", "source_note": "Sirah reconnue et hadiths authentiques."},
    {"id": "compagnons", "level": 13, "title": "Les Compagnons", "summary": "Leur role, leurs qualites et leur transmission.", "source_note": "Sources historiques sunnites reconnues, avec prudence."},
    {"id": "comportement", "level": 14, "title": "Le bon comportement", "summary": "Langue, sincerite, famille, voisinage, justice et pudeur.", "source_note": "Coran et hadiths authentiques sur l'akhlaq."},
    {"id": "histoire-islam", "level": 15, "title": "L'histoire de l'Islam", "summary": "Grandes periodes, prudence historique et reperes essentiels.", "source_note": "Sources historiques reconnues, avis divergents signales."},
]

class IslamLearnMessage(BaseModel):
    content: str
    level: Optional[str] = "débutant"
    topic: Optional[str] = None
    session_id: Optional[str] = None


class IslamAcademyNote(BaseModel):
    chapter_id: str
    content: str = Field(..., max_length=5000)

class IslamAcademyFavorite(BaseModel):
    chapter_id: str
    favorite: bool = True


@api_router.post("/islam-learning/chat")
async def islam_learning(message: IslamLearnMessage, user: dict = Depends(get_current_user)):
    """Cautious AI Islam teacher: step-by-step lessons, cites sources, never invents
    verses/hadiths, and refers fatwas/serious matters to a qualified scholar."""
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    session_id = message.session_id or str(uuid.uuid4())
    level = message.level or "débutant"
    topic = (message.topic or "").strip()

    system = (
        "Tu es un PROFESSEUR D'ISLAM bienveillant, pédagogue et surtout PRUDENT, pour "
        "l'application NEURA AL-NOUR. Tu enseignes l'Islam pas à pas, du niveau "
        f"**{level}**, de manière claire et simple.\n"
        "SUJETS : croyance (aqida), prière (salat), ablutions (wudu), jeûne (sawm), zakat, "
        "hajj, comportement (akhlaq), invocations (adhkar/duas), histoire des prophètes, "
        "lecture et compréhension du Coran.\n"
        "RÈGLES STRICTES :\n"
        "1. Cite tes sources quand c'est possible : Coran sous la forme (sourate:verset), "
        "hadith avec le recueil (Bukhari, Muslim...).\n"
        "2. N'INVENTE JAMAIS un verset ni un hadith. Ne modifie jamais le texte du Coran. "
        "Si tu n'es pas certain d'une référence exacte, dis-le honnêtement et reste général "
        "plutôt que d'inventer.\n"
        "3. Tu n'es PAS une autorité religieuse. Pour toute FATWA, question juridique précise "
        "(licite/illicite d'un cas particulier), ou sujet grave (mariage, divorce, héritage, "
        "situations personnelles délicates, santé, finances), tu NE donnes PAS de verdict : tu "
        "expliques les principes généraux puis tu invites clairement l'utilisateur à consulter "
        "une PERSONNE DE SCIENCE QUALIFIÉE (imam, savant reconnu).\n"
        "4. Reste humble, respectueux, encourageant. Va du simple au complexe selon le niveau.\n"
        "5. Réponds dans la langue de l'utilisateur.\n"
        "Quand on te demande une leçon sur un thème, structure ta réponse (définition, "
        "preuves/sources, étapes pratiques, exemple, puis une question pour réviser)."
    )
    if topic:
        system += f"\n\nThème demandé pour cette session : {topic}."
    system += MODERATION_GUARD + IDENTITY_GUARD

    history = await db.islam_messages.find(
        {"session_id": session_id, "user_id": user["id"]}, {"_id": 0}
    ).sort("created_at", 1).to_list(40)
    initial = [{"role": "system", "content": system}]
    for m in history:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            initial.append({"role": m["role"], "content": m["content"]})

    now = datetime.now(timezone.utc).isoformat()
    await db.islam_messages.insert_one({
        "id": str(uuid.uuid4()), "session_id": session_id, "user_id": user["id"],
        "role": "user", "content": message.content, "created_at": now,
    })

    provider, model = ("openai", "gpt-4o") if _is_premium_ai(user) else ("gemini", "gemini-2.5-flash")
    response, last_err = None, None
    for attempt in range(3):
        try:
            chat = LlmChat(api_key=AI_LLM_KEY, session_id=f"islam_{session_id}",
                           system_message=system, initial_messages=initial
                           ).with_model(provider, model).with_params(max_tokens=1200, temperature=0.3)
            response = await chat.send_message(UserMessage(text=message.content))
            last_err = None
            break
        except Exception as e:
            last_err = e
            es = str(e)
            if any(x in es for x in ("429", "503", "RESOURCE_EXHAUSTED", "UNAVAILABLE")) and attempt < 2:
                await asyncio.sleep(2 + attempt * 3)
                continue
            break
    if last_err is not None:
        logger.error(f"Islam learning error: {str(last_err)[:200]}")
        raise HTTPException(status_code=503, detail="Service IA temporairement indisponible. Réessaie.")

    await db.islam_messages.insert_one({
        "id": str(uuid.uuid4()), "session_id": session_id, "user_id": user["id"],
        "role": "assistant", "content": response, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"response": response, "session_id": session_id}


class IslamProgressUpdate(BaseModel):
    topic: str
    completed: bool = True
    level: Optional[str] = "débutant"


@api_router.get("/islam-learning/progress")
async def get_islam_learning_progress(user: dict = Depends(get_current_user)):
    progress = await db.islam_learning_progress.find_one(
        {"user_id": user["id"]}, {"_id": 0}
    )
    return progress or {
        "user_id": user["id"],
        "completed_topics": [],
        "current_topic": None,
        "level": "débutant",
    }


@api_router.post("/islam-learning/progress")
async def set_islam_learning_progress(
    data: IslamProgressUpdate, user: dict = Depends(get_current_user)
):
    topic = data.topic.strip()
    if not topic:
        raise HTTPException(status_code=400, detail="Thème requis")

    topic_update = (
        {"$addToSet": {"completed_topics": topic}}
        if data.completed
        else {"$pull": {"completed_topics": topic}}
    )
    topic_update["$set"] = {
        "user_id": user["id"],
        "current_topic": topic,
        "level": data.level or "débutant",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.islam_learning_progress.update_one(
        {"user_id": user["id"]}, topic_update, upsert=True
    )
    return await get_islam_learning_progress(user)


@api_router.get("/islam-learning/chapters")
async def get_islam_academy_chapters():
    return ISLAM_ACADEMY_CHAPTERS


@api_router.get("/islam-learning/search")
async def search_islam_academy(q: str = "", user: dict = Depends(get_current_user)):
    term = q.strip().lower()
    chapters = [
        chapter for chapter in ISLAM_ACADEMY_CHAPTERS
        if not term or term in chapter["title"].lower() or term in chapter["summary"].lower()
    ]
    notes = []
    if term:
        notes = await db.islam_learning_notes.find(
            {"user_id": user["id"], "content": {"$regex": term, "$options": "i"}},
            {"_id": 0}
        ).sort("updated_at", -1).to_list(50)
    return {"chapters": chapters, "notes": notes}


@api_router.get("/islam-learning/notes")
async def get_islam_academy_notes(user: dict = Depends(get_current_user)):
    return await db.islam_learning_notes.find(
        {"user_id": user["id"]}, {"_id": 0}
    ).sort("updated_at", -1).to_list(200)


@api_router.post("/islam-learning/notes")
async def save_islam_academy_note(data: IslamAcademyNote, user: dict = Depends(get_current_user)):
    if data.chapter_id not in {chapter["id"] for chapter in ISLAM_ACADEMY_CHAPTERS}:
        raise HTTPException(status_code=400, detail="Chapitre invalide.")
    now = datetime.now(timezone.utc).isoformat()
    note = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "chapter_id": data.chapter_id,
        "content": data.content.strip(),
        "updated_at": now,
    }
    await db.islam_learning_notes.update_one(
        {"user_id": user["id"], "chapter_id": data.chapter_id},
        {"$set": note, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return note


@api_router.post("/islam-learning/favorites")
async def set_islam_academy_favorite(data: IslamAcademyFavorite, user: dict = Depends(get_current_user)):
    if data.chapter_id not in {chapter["id"] for chapter in ISLAM_ACADEMY_CHAPTERS}:
        raise HTTPException(status_code=400, detail="Chapitre invalide.")
    update = {"$addToSet": {"favorite_topics": data.chapter_id}} if data.favorite else {"$pull": {"favorite_topics": data.chapter_id}}
    update["$set"] = {"user_id": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.islam_learning_progress.update_one({"user_id": user["id"]}, update, upsert=True)
    return await get_islam_learning_progress(user)


@api_router.get("/islam-learning/goals")
async def get_islam_academy_goals(user: dict = Depends(get_current_user)):
    progress = await get_islam_learning_progress(user)
    completed = len(progress.get("completed_topics", []))
    notes = await db.islam_learning_notes.count_documents({"user_id": user["id"]})
    goals = [
        {"id": "first-course", "label": "Terminer un premier cours", "done": completed >= 1},
        {"id": "three-chapters", "label": "Terminer 3 chapitres", "done": completed >= 3},
        {"id": "five-notes", "label": "Prendre 5 notes personnelles", "done": notes >= 5},
        {"id": "full-path", "label": "Terminer le parcours complet", "done": completed >= len(ISLAM_ACADEMY_CHAPTERS)},
    ]
    return {"goals": goals, "completed_chapters": completed, "total_chapters": len(ISLAM_ACADEMY_CHAPTERS)}


@api_router.get("/islam-learning/certificate")
async def get_islam_academy_certificate(user: dict = Depends(get_current_user)):
    progress = await get_islam_learning_progress(user)
    completed = set(progress.get("completed_topics", []))
    is_complete = all(chapter["id"] in completed for chapter in ISLAM_ACADEMY_CHAPTERS)
    return {
        "available": is_complete,
        "user_name": user.get("name"),
        "title": "Certificat de parcours - Academie de l'Islam",
        "completed_at": progress.get("updated_at") if is_complete else None,
        "completed_chapters": len(completed),
        "total_chapters": len(ISLAM_ACADEMY_CHAPTERS),
    }


# ============== SUBSCRIPTIONS ==============

@api_router.get("/subscriptions/plans")
async def get_subscription_plans():
    """Get all subscription plans"""
    return SUBSCRIPTION_PLANS

@api_router.post("/subscriptions/checkout")
async def create_checkout_session(request: SubscriptionRequest, user: dict = Depends(get_current_user)):
    """Create Stripe checkout session"""
    from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest
    
    if request.plan not in SUBSCRIPTION_PLANS or request.plan == "free":
        raise HTTPException(status_code=400, detail="Plan invalide")
    
    plan = SUBSCRIPTION_PLANS[request.plan]
    amount = plan["price_yearly"] if request.billing_period == "yearly" else plan["price_monthly"]
    
    # Build URLs
    success_url = f"{request.origin_url}/subscription/success?session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{request.origin_url}/subscription"
    
    # Use the external origin URL for webhook so Stripe can reach us
    webhook_url = f"{request.origin_url}/api/webhook/stripe"
    
    stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url=webhook_url)
    
    checkout_request = CheckoutSessionRequest(
        amount=float(amount),
        currency="eur",
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "user_id": user["id"],
            "plan": request.plan,
            "billing_period": request.billing_period
        }
    )
    
    session = await stripe_checkout.create_checkout_session(checkout_request)
    
    # Save transaction
    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": session.session_id,
        "user_id": user["id"],
        "amount": float(amount),
        "currency": "eur",
        "plan": request.plan,
        "billing_period": request.billing_period,
        "payment_status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {"url": session.url, "session_id": session.session_id}

@api_router.get("/subscriptions/status/{session_id}")
async def get_checkout_status(session_id: str, user: dict = Depends(get_current_user)):
    """Get checkout session status"""
    from emergentintegrations.payments.stripe.checkout import StripeCheckout
    
    stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url="")
    status = await stripe_checkout.get_checkout_status(session_id)
    
    # Update transaction and user if paid
    if status.payment_status == "paid":
        transaction = await db.payment_transactions.find_one(
            {"session_id": session_id},
            {"_id": 0}
        )
        
        if transaction and transaction["payment_status"] != "paid":
            await db.payment_transactions.update_one(
                {"session_id": session_id},
                {"$set": {"payment_status": "paid", "updated_at": datetime.now(timezone.utc).isoformat()}}
            )
            
            # Update user subscription
            await db.users.update_one(
                {"id": transaction["user_id"]},
                {"$set": {"subscription": transaction["plan"]}}
            )
    
    return {
        "status": status.status,
        "payment_status": status.payment_status
    }

@api_router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe webhooks"""
    from emergentintegrations.payments.stripe.checkout import StripeCheckout
    
    body = await request.body()
    signature = request.headers.get("Stripe-Signature")
    
    stripe_checkout = StripeCheckout(api_key=STRIPE_API_KEY, webhook_url="")
    
    try:
        webhook_response = await stripe_checkout.handle_webhook(body, signature)
        
        if webhook_response.payment_status == "paid":
            await db.payment_transactions.update_one(
                {"session_id": webhook_response.session_id},
                {"$set": {"payment_status": "paid", "updated_at": datetime.now(timezone.utc).isoformat()}}
            )
            
            # Update user subscription
            metadata = webhook_response.metadata
            if metadata and "user_id" in metadata:
                await db.users.update_one(
                    {"id": metadata["user_id"]},
                    {"$set": {"subscription": metadata.get("plan", "free")}}
                )
        
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Webhook error: {e}")
        return {"status": "error"}

# ============== BASE ROUTES ==============

@api_router.get("/")
async def root():
    return {"message": "NEURA AL-NOUR API - بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy", "app": "NEURA AL-NOUR"}

@api_router.get("/system/health")
async def system_health():
    started = time.perf_counter()
    db_ok = True
    db_error = None
    try:
        await db.command("ping")
    except Exception as error:
        db_ok = False
        db_error = str(error)[:200]
    return {
        "status": "healthy" if db_ok else "degraded",
        "app": "NEURA AL-NOUR",
        "version": app.version,
        "date": datetime.now(timezone.utc).isoformat(),
        "database": {"ok": db_ok, "error": db_error},
        "response_ms": round((time.perf_counter() - started) * 1000),
    }

@api_router.get("/system/architecture")
async def system_architecture(user: dict = Depends(get_current_user)):
    role = _founder_admin_role(user)
    return {
        "app": "NEURA AL-NOUR",
        "api_version": "v1",
        "modules": SYSTEM_MODULES,
        "principles": [
            "Les modules religieux restent gratuits.",
            "Les donnees sensibles restent cote serveur.",
            "Les actions sensibles sont validees cote backend.",
            "Le lecteur Coran et les recitations restent independants.",
        ],
        "admin_access": bool(role),
    }

@api_router.get("/system/logs")
async def system_logs(limit: int = 100, user: dict = Depends(get_current_user)):
    await _require_founder_admin(user)
    return await db.system_logs.find({}, {"_id": 0}).sort("created_at", -1).to_list(max(1, min(limit, 200)))

# Include router
app.include_router(api_router)

# Serve Digital Asset Links for Google Play domain verification
from fastapi.responses import JSONResponse

ASSET_LINKS_DATA = [
    {
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": "com.neuraalnour.app",
            "sha256_cert_fingerprints": [
                "6D:B2:62:6F:A8:C9:BF:39:CE:CB:78:CC:42:EF:AA:26:AD:4F:8D:E6:A2:3A:B0:44:C6:C4:21:39:16:9C:46:BF"
            ]
        }
    }
]

@app.get("/.well-known/assetlinks.json")
async def asset_links():
    return JSONResponse(
        content=ASSET_LINKS_DATA,
        headers={"Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*"}
    )

@app.get("/api/.well-known/assetlinks.json")
async def asset_links_api():
    return JSONResponse(
        content=ASSET_LINKS_DATA,
        headers={"Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*"}
    )

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

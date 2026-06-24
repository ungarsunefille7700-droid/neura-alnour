from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
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
import jwt
import bcrypt
import asyncio
import resend
import base64
import httpx

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
MODEL_PROFILES = {
    "chatgpt": {
        "label": "ChatGPT",
        "model_id": "gemini-2.5-flash",
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
        "model_id": "gemini-2.5-flash",
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

# Developer tiers. Limits are by request count / response size / files / memory
# (single AI engine = Gemini; no extra paid provider). window_hours = regeneration delay.
DEV_TIERS = {
    "free":  {"label": "Gratuit",     "requests": 5,    "window_hours": 4, "max_tokens": 1024, "max_files": 2,  "memory_turns": 6,  "project_analysis": False},
    "plus":  {"label": "Neura+",      "requests": 150,  "window_hours": 1, "max_tokens": 4096, "max_files": 10, "memory_turns": 30, "project_analysis": True},
    "ultra": {"label": "Neura Ultra", "requests": 1000, "window_hours": 1, "max_tokens": 8192, "max_files": 30, "memory_turns": 60, "project_analysis": True},
}

def get_dev_tier(user: dict) -> str:
    """Resolve a user's developer tier (founders/VIP -> ultra)."""
    if user.get("is_vip") or is_founder(user.get("email")):
        return "ultra"
    sub = user.get("subscription", "free")
    if sub == "neura_ultra":
        return "ultra"
    if sub == "neura_plus":
        return "plus"
    return "free"

def _dev_is_unlimited(user: dict) -> bool:
    return bool(user.get("is_vip") or is_founder(user.get("email")))

# Security
security = HTTPBearer(auto_error=False)

# Create the main app
app = FastAPI(title="NEURA AL-NOUR API", version="1.0.0")

# Create router with /api prefix
api_router = APIRouter(prefix="/api")

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
    model: Optional[str] = None
    lang: Optional[str] = None
    web_search: Optional[bool] = False

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
    if user.get("is_vip"):
        return True
    subscription = user.get("subscription", "free")
    plan = SUBSCRIPTION_PLANS.get(subscription, SUBSCRIPTION_PLANS["free"])
    return feature in plan.get("features", [])

# ============== AUTH ROUTES ==============

# Google OAuth Session endpoint
@api_router.post("/auth/google/session")
async def google_auth_session(request: Request):
    """Exchange Google OAuth session_id for user session"""
    try:
        body = await request.json()
        session_id = body.get("session_id")
        
        if not session_id:
            raise HTTPException(status_code=400, detail="session_id requis")
        
        # Call Emergent Auth to get user data
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": session_id}
            )
            
            if response.status_code != 200:
                raise HTTPException(status_code=401, detail="Session invalide")
            
            google_data = response.json()
        
        email = google_data.get("email")
        name = google_data.get("name")
        picture = google_data.get("picture")
        session_token = google_data.get("session_token")
        
        # Check if VIP admin
        is_vip = any(admin["email"] == email for admin in VIP_ADMINS)
        
        # Check if user exists
        existing_user = await db.users.find_one({"email": email}, {"_id": 0})
        
        if existing_user:
            user_id = existing_user["id"]
            # Update user info if needed
            await db.users.update_one(
                {"email": email},
                {"$set": {
                    "name": name,
                    "picture": picture,
                    "is_vip": is_vip,
                    "subscription": "developer" if is_vip else existing_user.get("subscription", "free")
                }}
            )
        else:
            # Create new user
            user_id = str(uuid.uuid4())
            user = {
                "id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "password": None,  # Google auth users don't have password
                "subscription": "developer" if is_vip else "free",
                "is_vip": is_vip,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "screens_today": 0,
                "images_today": 0,
                "last_reset": datetime.now(timezone.utc).date().isoformat()
            }
            await db.users.insert_one(user)
        
        # Store session in database
        expires_at = datetime.now(timezone.utc) + timedelta(days=7)
        await db.user_sessions.update_one(
            {"user_id": user_id},
            {"$set": {
                "user_id": user_id,
                "session_token": session_token,
                "expires_at": expires_at.isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat()
            }},
            upsert=True
        )
        
        # Create JWT token
        token = create_token(user_id, email, is_vip)
        
        # Get updated user
        user = await db.users.find_one({"id": user_id}, {"_id": 0})
        
        return {
            "token": token,
            "session_token": session_token,
            "user": {
                "id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "subscription": user.get("subscription", "free"),
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
    
    # Check if VIP admin
    is_vip = any(admin["email"] == user_data.email for admin in VIP_ADMINS)
    
    user_id = str(uuid.uuid4())
    user = {
        "id": user_id,
        "email": user_data.email,
        "name": user_data.name,
        "password": hash_password(user_data.password),
        "subscription": "developer" if is_vip else "free",  # VIP gets all features
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

# ============== CHAT ROUTES ==============

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

بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"""
    
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
                    api_key=GEMINI_API_KEY,
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
                    api_key=GEMINI_API_KEY,
                    session_id=f"neura_{conversation_id}",
                    system_message=persona_system,
                    initial_messages=initial_messages
                ).with_model("gemini", profile["model_id"]).with_params(**profile["params"])
            
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
        "conversation_id": conversation_id
    }


async def tavily_search(query: str, max_results: int = 5):
    """Run a web search via Tavily. Returns a list of {title, url, snippet}."""
    api_key = os.environ.get('TAVILY_API_KEY')
    if not api_key:
        return []
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.tavily.com/search",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"query": query, "max_results": max_results, "search_depth": "basic"},
        )
        resp.raise_for_status()
        data = resp.json()
    return [
        {"title": r.get("title", ""), "url": r.get("url", ""), "snippet": r.get("content", "")}
        for r in data.get("results", [])
    ]


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

            # Conversation history (exclude the message we just saved)
            history = await db.messages.find(
                {"conversation_id": conversation_id}, {"_id": 0}
            ).sort("created_at", 1).to_list(50)

            # Build the system prompt (model persona + precedence + active language)
            profile = MODEL_PROFILES.get(message.model, MODEL_PROFILES[DEFAULT_MODEL])
            system_prompt = BASE_CHAT_SYSTEM + "\n\n" + profile["persona"] + "\n\n" + STYLE_PRECEDENCE + MODERATION_GUARD + IDENTITY_GUARD
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
                if sources:
                    system_prompt += (
                        "\n\nTu disposes de résultats de recherche web ci-dessous. "
                        "Utilise-les et cite les sources pertinentes avec [1], [2], etc."
                    )
                    block = "\n\n".join(
                        f"[{i}] {s['title']}\n{s['url']}\n{s['snippet']}"
                        for i, s in enumerate(sources, 1)
                    )
                    user_text = f"Résultats de recherche web :\n{block}\n\nQuestion : {message.content}"

            # initial_messages must include the system prompt first (the library does NOT
            # auto-add it when initial_messages is provided).
            initial_messages = [{"role": "system", "content": system_prompt}]
            for m in history[:-1]:
                if m.get("role") in ("user", "assistant") and m.get("content"):
                    initial_messages.append({"role": m["role"], "content": m["content"]})

            # Writing phase + real token streaming
            yield sse({"type": "phase", "phase": "writing"})
            chat = LlmChat(
                api_key=GEMINI_API_KEY,
                session_id=f"neura_stream_{conversation_id}",
                system_message=system_prompt,
                initial_messages=initial_messages,
            ).with_model("gemini", profile["model_id"]).with_params(**profile["params"])

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
            api_key=GEMINI_API_KEY,
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

    system_prompt = _build_dev_system_prompt(tier_name)
    # Expert role (Neura+/Ultra only) — adopt a senior specialist persona.
    if message.role in DEV_ROLES and tier_name in ("plus", "ultra"):
        system_prompt += (
            f"\n\nRÔLE ACTIF : Tu interviens en tant que {DEV_ROLES[message.role]}. "
            "Adopte l'expertise, le vocabulaire, les priorités et les bonnes pratiques de ce rôle."
        )
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
        if sources:
            block = "\n\n".join(
                f"[{i}] {s['title']}\n{s['url']}\n{s['snippet']}"
                for i, s in enumerate(sources, 1)
            )
            user_text = (
                "Résultats de recherche web (utilise-les et cite les sources pertinentes "
                f"avec [1], [2]...) :\n{block}\n\nDemande : {message.content}"
            )

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

    response = None
    last_err = None
    for attempt in range(3):
        try:
            chat = LlmChat(
                api_key=GEMINI_API_KEY,
                session_id=f"dev_{session_id}",
                system_message=system_prompt,
                initial_messages=initial_messages,
            ).with_model("gemini", "gemini-2.5-flash").with_params(
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
        "is_founder": bool(user.get("is_vip") or is_founder(user.get("email"))),
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

"""Neura Gateway: the Neura Al Noor API, with its own `nan_` keys.

Public API (OpenAI-compatible, so any OpenAI client works with base_url=…/v1):
    GET  /v1/models
    POST /v1/chat/completions        (stream or not)
    GET  /v1/usage                   (the calling key's own usage today)

Administration (founders / admins, JWT session of the app):
    GET  /api/gateway/status
    GET  /api/gateway/keys
    POST /api/gateway/keys           (the secret is shown once, only its HMAC is stored)
    POST /api/gateway/keys/{id}/revoke
    GET  /api/gateway/stats?days=7

The gateway knows nothing about Cloudflare: it calls the Neura engine
(neura_engine.NeuraRuntime), which calls whatever provider is configured.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Callable, List, Literal, Optional, Union

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field, field_validator

from neura_engine import EngineRefused, get_runtime

KEY_PREFIX = "nan_"
SCOPES = ("chat",)
MAX_TOTAL_CHARS = 40_000
MAX_MESSAGES = 100


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _api_error(status: int, message: str, code: str, err_type: str = "invalid_request_error", headers=None):
    return JSONResponse(
        status_code=status,
        content={"error": {"message": message, "type": err_type, "code": code}},
        headers=headers,
    )


class GatewayError(Exception):
    def __init__(self, status: int, message: str, code: str, err_type: str = "invalid_request_error", headers=None):
        super().__init__(message)
        self.status, self.message, self.code, self.err_type, self.headers = status, message, code, err_type, headers

    def response(self):
        return _api_error(self.status, self.message, self.code, self.err_type, self.headers)


class ChatMessageIn(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: Union[str, List[dict]]

    def text(self) -> str:
        if isinstance(self.content, str):
            return self.content
        return "\n".join(p.get("text", "") for p in self.content if isinstance(p, dict) and p.get("type") == "text")


class ChatCompletionIn(BaseModel):
    model: Optional[str] = None
    messages: List[ChatMessageIn] = Field(min_length=1, max_length=MAX_MESSAGES)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=4096)
    max_completion_tokens: Optional[int] = Field(default=None, ge=1, le=4096)
    temperature: Optional[float] = Field(default=0.6, ge=0, le=2)
    stream: bool = False

    @field_validator("messages")
    @classmethod
    def _size(cls, messages):
        total = sum(len(m.text()) for m in messages)
        if total > MAX_TOTAL_CHARS:
            raise ValueError(f"messages too long ({total} characters, max {MAX_TOTAL_CHARS}).")
        if not any(m.role == "user" and m.text().strip() for m in messages):
            raise ValueError("at least one non-empty user message is required.")
        return messages


class KeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    requests_per_minute: int = Field(default=20, ge=1, le=300)
    daily_neurons: Optional[float] = Field(default=500, ge=1, le=10_000)
    max_concurrent: int = Field(default=2, ge=1, le=20)
    max_output_tokens: int = Field(default=700, ge=16, le=4096)
    expires_in_days: Optional[int] = Field(default=None, ge=1, le=3650)


class AuthFailureLimiter:
    """Blocks an address after too many bad keys (brute-force protection)."""

    def __init__(self, max_failures: int = 20, window_seconds: int = 600, monotonic=time.monotonic):
        self.max_failures, self.window, self.monotonic = max_failures, window_seconds, monotonic
        self._failures = defaultdict(deque)

    def _trim(self, ip):
        now, items = self.monotonic(), self._failures[ip]
        while items and now - items[0] > self.window:
            items.popleft()
        return items

    def blocked(self, ip) -> bool:
        return len(self._trim(ip)) >= self.max_failures

    def fail(self, ip):
        self._trim(ip).append(self.monotonic())


def hash_key(secret: str, pepper: str) -> str:
    return hmac.new(pepper.encode("utf-8"), secret.encode("utf-8"), hashlib.sha256).hexdigest()


def generate_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(32)


def public_key_doc(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in ("_id", "hash")}


def create_gateway_routers(*, db, get_current_user: Callable, require_admin: Callable, pepper: str,
                           admin_log: Optional[Callable] = None):
    if not pepper or len(pepper) < 16:
        raise RuntimeError("The Neura Gateway needs a secret pepper of at least 16 characters.")

    public = APIRouter(prefix="/v1", tags=["Neura Al Noor API"])
    admin = APIRouter(prefix="/api/gateway", tags=["Neura Gateway admin"])
    failures = AuthFailureLimiter()
    in_flight = defaultdict(int)

    async def ensure_indexes():
        await db.api_keys.create_index("hash", unique=True)
        await db.api_keys.create_index("id", unique=True)
        await db.api_rate_counters.create_index("expires_at", expireAfterSeconds=0)

    # ---------- authentication ----------
    async def authenticate(request: Request, authorization: Optional[str], x_api_key: Optional[str]) -> dict:
        ip = request.client.host if request.client else "?"
        if failures.blocked(ip):
            raise GatewayError(429, "Too many invalid API keys from this address. Try again later.",
                               "auth_blocked", "rate_limit_error")
        secret = None
        if authorization and authorization.lower().startswith("bearer "):
            secret = authorization[7:].strip()
        secret = secret or (x_api_key or "").strip()
        if not secret or not secret.startswith(KEY_PREFIX) or len(secret) > 100:
            failures.fail(ip)
            raise GatewayError(401, "Missing or invalid Neura Al Noor API key (nan_…).", "invalid_api_key",
                               "authentication_error")
        doc = await db.api_keys.find_one({"hash": hash_key(secret, pepper)}, {"_id": 0})
        if not doc:
            failures.fail(ip)
            raise GatewayError(401, "Invalid Neura Al Noor API key.", "invalid_api_key", "authentication_error")
        if doc.get("status") != "active":
            raise GatewayError(401, "This API key has been revoked.", "revoked_api_key", "authentication_error")
        expires_at = doc.get("expires_at")
        if expires_at and datetime.fromisoformat(expires_at) <= _now():
            raise GatewayError(401, "This API key has expired.", "expired_api_key", "authentication_error")
        return doc

    async def check_rate(doc: dict):
        minute = int(time.time() // 60)
        counter_id = f"rpm:{doc['id']}:{minute}"
        await db.api_rate_counters.update_one(
            {"_id": counter_id},
            {"$inc": {"n": 1}, "$setOnInsert": {"expires_at": _now() + timedelta(minutes=2)}},
            upsert=True,
        )
        counter = await db.api_rate_counters.find_one({"_id": counter_id})
        if counter and counter.get("n", 0) > doc["limits"]["requests_per_minute"]:
            raise GatewayError(429, "Rate limit reached for this API key (requests per minute).",
                               "rate_limit_exceeded", "rate_limit_error", {"Retry-After": "60"})

    def subject_for(doc: dict) -> dict:
        return {"kind": "key", "id": doc["id"], "plan": "api", "limit": doc["limits"].get("daily_neurons")}

    def to_messages(body: ChatCompletionIn) -> List[dict]:
        return [{"role": m.role, "content": m.text()} for m in body.messages if m.text()]

    def runtime_or_error():
        runtime = get_runtime()
        if not runtime or not runtime.enabled:
            raise GatewayError(503, "The Neura Al Noor inference engine is not configured.", "engine_not_configured",
                               "server_error")
        return runtime

    def refusal_error(exc: EngineRefused) -> GatewayError:
        if exc.code == "quota":
            return GatewayError(429, exc.user_message, "insufficient_quota", "insufficient_quota")
        if exc.code == "saturated":
            return GatewayError(503, exc.user_message, "engine_saturated", "server_error", {"Retry-After": "10"})
        return GatewayError(400, exc.user_message, exc.code)

    # ---------- public API ----------
    @public.get("/models")
    async def list_models(request: Request, authorization: Optional[str] = Header(None),
                          x_api_key: Optional[str] = Header(None)):
        try:
            await authenticate(request, authorization, x_api_key)
            runtime = runtime_or_error()
        except GatewayError as exc:
            return exc.response()
        return {"object": "list", "data": [
            {"id": runtime.public_model, "object": "model", "created": 0, "owned_by": "neura-al-noor"}
        ]}

    @public.get("/usage")
    async def key_usage(request: Request, authorization: Optional[str] = Header(None),
                        x_api_key: Optional[str] = Header(None)):
        try:
            doc = await authenticate(request, authorization, x_api_key)
            runtime = runtime_or_error()
        except GatewayError as exc:
            return exc.response()
        snapshot = await runtime.budget.snapshot(subject_for(doc))
        return {"key": public_key_doc(doc), "today": snapshot.get("subject"), "reset_at": snapshot["reset_at"]}

    @public.post("/chat/completions")
    async def chat_completions(body: ChatCompletionIn, request: Request,
                               authorization: Optional[str] = Header(None), x_api_key: Optional[str] = Header(None)):
        try:
            doc = await authenticate(request, authorization, x_api_key)
            if "chat" not in doc.get("scopes", []):
                raise GatewayError(403, "This API key is not allowed to use chat.", "scope_denied", "permission_error")
            runtime = runtime_or_error()
            await check_rate(doc)
            if in_flight[doc["id"]] >= doc["limits"]["max_concurrent"]:
                raise GatewayError(429, "Too many simultaneous requests for this API key.", "concurrency_limit",
                                   "rate_limit_error", {"Retry-After": "5"})
        except GatewayError as exc:
            return exc.response()

        limit = doc["limits"]["max_output_tokens"]
        max_tokens = min(body.max_completion_tokens or body.max_tokens or limit, limit)
        messages = to_messages(body)
        subject = subject_for(doc)
        completion_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
        created = int(time.time())
        await db.api_keys.update_one({"id": doc["id"]}, {"$set": {"last_used_at": _now().isoformat()},
                                                         "$inc": {"total_requests": 1}})

        if not body.stream:
            in_flight[doc["id"]] += 1
            try:
                text, info = await runtime.complete(messages, max_tokens=max_tokens, temperature=body.temperature,
                                                    subject=subject, source="api")
            except EngineRefused as exc:
                return refusal_error(exc).response()
            except Exception:
                return _api_error(502, "The inference engine failed. Try again.", "engine_error", "server_error")
            finally:
                in_flight[doc["id"]] -= 1
            return {
                "id": completion_id, "object": "chat.completion", "created": created, "model": runtime.public_model,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": info["prompt_tokens"], "completion_tokens": info["completion_tokens"],
                          "total_tokens": info["prompt_tokens"] + info["completion_tokens"],
                          "neurons": info["neurons"], "cached": info["cached"]},
            }

        def chunk(delta: dict, finish=None, usage=None) -> str:
            payload = {"id": completion_id, "object": "chat.completion.chunk", "created": created,
                       "model": runtime.public_model,
                       "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
            if usage is not None:
                payload["usage"] = usage
            return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

        stream = runtime.stream(messages, max_tokens=max_tokens, temperature=body.temperature,
                                subject=subject, source="api")
        # Start the engine before answering, so quota/saturation refusals keep their HTTP status.
        in_flight[doc["id"]] += 1
        try:
            first = await stream.__anext__()
        except EngineRefused as exc:
            in_flight[doc["id"]] -= 1
            return refusal_error(exc).response()
        except StopAsyncIteration:
            first = None
        except Exception:
            in_flight[doc["id"]] -= 1
            return _api_error(502, "The inference engine failed. Try again.", "engine_error", "server_error")

        async def events():
            try:
                yield chunk({"role": "assistant", "content": ""})
                pending = [first] if first else []
                info = {}
                while True:
                    if pending:
                        kind, value = pending.pop()
                    else:
                        try:
                            kind, value = await stream.__anext__()
                        except StopAsyncIteration:
                            break
                    if kind == "delta":
                        yield chunk({"content": value})
                    else:
                        info = value
                usage = {"prompt_tokens": info.get("prompt_tokens", 0),
                         "completion_tokens": info.get("completion_tokens", 0),
                         "total_tokens": info.get("prompt_tokens", 0) + info.get("completion_tokens", 0),
                         "neurons": info.get("neurons", 0.0), "cached": info.get("cached", False)}
                yield chunk({}, "stop", usage)
                yield "data: [DONE]\n\n"
            except Exception:
                err = {"error": {"message": "The inference engine failed mid-answer.", "type": "server_error",
                                 "code": "engine_error"}}
                yield f"data: {json.dumps(err)}\n\n"
            finally:
                in_flight[doc["id"]] -= 1
                await stream.aclose()

        return StreamingResponse(events(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    # ---------- administration ----------
    async def admin_user(user: dict = Depends(get_current_user)):
        await require_admin(user)
        return user

    @admin.get("/status")
    async def gateway_status(user: dict = Depends(admin_user)):
        runtime = get_runtime()
        if not runtime:
            return {"engine": None, "budget": None}
        return {"engine": runtime.status(),
                "budget": await runtime.budget.snapshot() if runtime.enabled else None,
                "queue": runtime.gate.stats()}

    @admin.get("/keys")
    async def list_keys(user: dict = Depends(admin_user)):
        keys = await db.api_keys.find({}, {"_id": 0, "hash": 0}).sort("created_at", -1).to_list(500)
        runtime = get_runtime()
        if runtime and runtime.enabled:
            for key in keys:
                snap = await runtime.budget.snapshot(subject_for(key))
                key["today"] = snap.get("subject")
        return keys

    @admin.post("/keys")
    async def create_key(data: KeyCreate, user: dict = Depends(admin_user)):
        secret = generate_key()
        now = _now()
        doc = {
            "id": str(uuid.uuid4()),
            "name": data.name.strip(),
            "prefix": secret[:10],
            "last4": secret[-4:],
            "hash": hash_key(secret, pepper),
            "owner_id": user.get("id"),
            "owner_email": user.get("email"),
            "scopes": list(SCOPES),
            "limits": {
                "requests_per_minute": data.requests_per_minute,
                "daily_neurons": data.daily_neurons,
                "max_concurrent": data.max_concurrent,
                "max_output_tokens": data.max_output_tokens,
            },
            "status": "active",
            "created_at": now.isoformat(),
            "expires_at": (now + timedelta(days=data.expires_in_days)).isoformat() if data.expires_in_days else None,
            "last_used_at": None,
            "revoked_at": None,
            "total_requests": 0,
        }
        await db.api_keys.insert_one(dict(doc))
        if admin_log:
            await admin_log("api_key_created", user, None, {"key_id": doc["id"], "name": doc["name"]})
        return {"key": secret, "api_key": public_key_doc(doc),
                "warning": "Copie cette clé maintenant : elle ne sera plus jamais affichée."}

    @admin.post("/keys/{key_id}/revoke")
    async def revoke_key(key_id: str, user: dict = Depends(admin_user)):
        result = await db.api_keys.update_one(
            {"id": key_id, "status": "active"},
            {"$set": {"status": "revoked", "revoked_at": _now().isoformat(), "revoked_by": user.get("id")}},
        )
        if result.modified_count != 1:
            raise HTTPException(status_code=404, detail="Clé introuvable ou déjà révoquée.")
        if admin_log:
            await admin_log("api_key_revoked", user, None, {"key_id": key_id})
        return {"ok": True}

    @admin.get("/stats")
    async def gateway_stats(days: int = 7, user: dict = Depends(admin_user)):
        runtime = get_runtime()
        if not runtime or not runtime.enabled:
            return {"engine": runtime.status() if runtime else None, "enabled": False}
        stats = await runtime.stats(days)
        stats["enabled"] = True
        return stats

    return public, admin, ensure_indexes

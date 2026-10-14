"""Neura engine: the single place where AI inference happens.

    app routes / Neura Gateway (/v1)  ->  NeuraRuntime  ->  InferenceProvider
                                         (budget, queue,     (Cloudflare today,
                                          cache, history      self-hosted later)
                                          compaction, stats)

`LlmChat` below is a drop-in replacement for emergentintegrations' LlmChat: the
existing routes keep their code. When no provider is configured
(NEURA_INFERENCE_PROVIDER=emergent, the default) everything behaves exactly as
before. When a provider is configured, text requests go to it; what it cannot
do (image attachments, tool calls) keeps the legacy path only if
NEURA_LEGACY_AI=on, otherwise it is refused — never billed.
"""
from __future__ import annotations

import contextvars
import hashlib
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from emergentintegrations.llm.chat import (  # noqa: F401  (re-exported for server.py)
    ChatError,
    FileContent,
    LlmChat as _LegacyLlmChat,
    StreamDone,
    TextDelta,
    Usage,
    UserMessage,
)

from neura_budget import BudgetExceeded, ConcurrencyGate, NeuronBudget, Saturated
from neura_inference import (
    InferenceProvider,
    ProviderError,
    build_provider_from_env,
    estimate_messages_tokens,
    estimate_tokens,
)

logger = logging.getLogger("neura.engine")

# Who the current request is for (set by get_current_user / the gateway).
current_ai_subject: contextvars.ContextVar[Optional[dict]] = contextvars.ContextVar(
    "neura_ai_subject", default=None
)

QUOTA_PREFIX = "NEURA_QUOTA:"


class EngineRefused(ChatError):
    """A refusal the user must see as-is (quota, saturation, free mode)."""

    def __init__(self, message: str, code: str):
        super().__init__(f"{QUOTA_PREFIX}{message}")
        self.user_message = message
        self.code = code


def user_facing_ai_error(exc: BaseException) -> Optional[str]:
    """The French message to show for a refusal, or None for an ordinary failure."""
    if isinstance(exc, EngineRefused):
        return exc.user_message
    text = str(exc)
    if QUOTA_PREFIX in text:
        return text.split(QUOTA_PREFIX, 1)[1].strip()
    return None


def _env_float(env, name, default):
    try:
        return float(env.get(name, default))
    except (TypeError, ValueError):
        return float(default)


def _flatten(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(
            part.get("text", "") for part in content if isinstance(part, dict) and part.get("type") == "text"
        )
    return ""


def compact_messages(messages: List[dict], *, keep_last: int, older_chars: int, older_items: int,
                     max_input_tokens: int, max_message_chars: int = 4000) -> List[dict]:
    """Keep the system prompt and the last `keep_last` turns verbatim; older turns
    become a short digest, so long conversations keep their thread for a fraction
    of the tokens. Then trim the oldest kept turns until under `max_input_tokens`."""
    system = [m for m in messages if m["role"] == "system"]
    turns = [m for m in messages if m["role"] in ("user", "assistant")]
    recent = turns[-keep_last:] if keep_last > 0 else []
    older = turns[: len(turns) - len(recent)]
    recent = [{"role": m["role"], "content": m["content"][:max_message_chars]} for m in recent]
    head = [{"role": "system", "content": "\n\n".join(m["content"] for m in system)}] if system else []
    if older:
        lines = []
        for m in older[-older_items:]:
            who = "Utilisateur" if m["role"] == "user" else "Neura"
            snippet = " ".join(m["content"].split())[:older_chars]
            if snippet:
                lines.append(f"- {who} : {snippet}")
        if lines:
            digest = "Début de la conversation (résumé des anciens échanges) :\n" + "\n".join(lines)
            if head:
                head[0]["content"] += "\n\n" + digest
            else:
                head = [{"role": "system", "content": digest}]
    result = head + recent
    while len(result) > len(head) + 1 and estimate_messages_tokens(result) > max_input_tokens:
        result.pop(len(head))
    return result


class NeuraRuntime:
    def __init__(self, db, provider: Optional[InferenceProvider], env=os.environ):
        self.db = db
        self.provider = provider
        self.model = (provider.default_model if provider else "") or env.get("NEURA_ENGINE_MODEL", "")
        self.public_model = env.get("NEURA_PUBLIC_MODEL_NAME", "neura-al-noor")
        self.legacy_allowed = env.get("NEURA_LEGACY_AI", "on").strip().lower() != "off"
        self.max_output_tokens = int(_env_float(env, "NEURA_ENGINE_MAX_OUTPUT_TOKENS", 700))
        self.max_input_tokens = int(_env_float(env, "NEURA_ENGINE_MAX_INPUT_TOKENS", 6000))
        self.keep_last = int(_env_float(env, "NEURA_ENGINE_HISTORY_MESSAGES", 10))
        self.older_chars = int(_env_float(env, "NEURA_ENGINE_DIGEST_CHARS", 160))
        self.older_items = int(_env_float(env, "NEURA_ENGINE_DIGEST_ITEMS", 12))
        self.cache_enabled = env.get("NEURA_AI_CACHE", "on").strip().lower() != "off"
        self.cache_days = int(_env_float(env, "NEURA_AI_CACHE_DAYS", 7))
        self.stt_enabled = bool(provider and provider.supports_stt
                                and env.get("NEURA_VOICE_STT_PROVIDER", "legacy").lower() == "engine")
        self.tts_enabled = bool(provider and provider.supports_tts
                                and env.get("NEURA_VOICE_TTS_PROVIDER", "legacy").lower() == "engine")

        def plan_limit(name, default):
            value = env.get(name, default)
            return None if str(value).strip().lower() in ("", "none", "unlimited") else float(value)

        self.budget = NeuronBudget(
            db,
            daily_limit=_env_float(env, "NEURA_AI_DAILY_NEURONS", 9000),
            plan_limits={
                "free": plan_limit("NEURA_AI_USER_NEURONS_FREE", 250),
                "paid": plan_limit("NEURA_AI_USER_NEURONS_PAID", 900),
                "vip": plan_limit("NEURA_AI_USER_NEURONS_VIP", "unlimited"),
                "system": None,
            },
            free_share=_env_float(env, "NEURA_AI_FREE_SHARE", 0.7),
        )
        self.gate = ConcurrencyGate(
            max_concurrent=int(_env_float(env, "NEURA_AI_MAX_CONCURRENT", 20)),
            max_queue=int(_env_float(env, "NEURA_AI_MAX_QUEUE", 100)),
            queue_timeout=_env_float(env, "NEURA_AI_QUEUE_TIMEOUT", 25),
            # Workers AI allows 300 text-generation requests per minute (free plan).
            rpm_limit=int(_env_float(env, "NEURA_AI_RPM", 280)),
        )

    # ---------- configuration ----------
    @property
    def enabled(self) -> bool:
        return self.provider is not None

    def status(self) -> dict:
        return {
            "provider": self.provider.name if self.provider else "emergent",
            "model": self.model or None,
            "public_model": self.public_model,
            "legacy_ai": self.legacy_allowed,
            "max_output_tokens": self.max_output_tokens,
            "history_messages": self.keep_last,
            "cache": self.cache_enabled,
            "voice_stt": "engine" if self.stt_enabled else "legacy",
            "voice_tts": "engine" if self.tts_enabled else "legacy",
        }

    async def ensure_indexes(self):
        try:
            await self.db.ai_usage_log.create_index("created_at", expireAfterSeconds=60 * 60 * 24 * 30)
            await self.db.ai_usage_log.create_index([("day", 1), ("source", 1)])
            await self.db.ai_response_cache.create_index("created_at", expireAfterSeconds=60 * 60 * 24 * self.cache_days)
        except Exception as exc:  # index creation must never block startup
            logger.warning("AI index creation skipped: %s", str(exc)[:150])

    # ---------- helpers ----------
    def prepare(self, messages: List[dict]) -> List[dict]:
        flat = [{"role": m.get("role"), "content": _flatten(m.get("content"))} for m in messages]
        flat = [m for m in flat if m["role"] in ("system", "user", "assistant") and m["content"]]
        return compact_messages(
            flat, keep_last=self.keep_last, older_chars=self.older_chars, older_items=self.older_items,
            max_input_tokens=self.max_input_tokens,
        )

    def _cache_key(self, messages: List[dict]) -> Optional[str]:
        # Only first questions (system + one user message) are cacheable: their answer
        # does not depend on a conversation. The system prompt is part of the key, so
        # personal context (memory, name) never leaks between users.
        if not self.cache_enabled or len(messages) != 2 or messages[-1]["role"] != "user":
            return None
        question = " ".join(messages[-1]["content"].lower().split())
        raw = f"{self.model}\n{messages[0]['content']}\n{question}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    async def _cache_get(self, key):
        if not key:
            return None
        doc = await self.db.ai_response_cache.find_one({"_id": key})
        if not doc:
            return None
        created = doc.get("created_at")
        if isinstance(created, datetime):
            created = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
            if created < datetime.now(timezone.utc) - timedelta(days=self.cache_days):
                return None
        return doc.get("text")

    async def _cache_put(self, key, text):
        if key and text:
            await self.db.ai_response_cache.update_one(
                {"_id": key}, {"$set": {"text": text, "created_at": datetime.now(timezone.utc)}}, upsert=True
            )

    async def _log(self, *, source, subject, status, result=None, neurons=0.0, cached=False, latency_ms=0, error=None):
        now = datetime.now(timezone.utc)
        doc = {
            "created_at": now,
            "day": now.strftime("%Y-%m-%d"),
            "source": source,
            "subject_kind": (subject or {}).get("kind"),
            "subject_id": (subject or {}).get("id"),
            "plan": (subject or {}).get("plan"),
            "provider": self.provider.name if self.provider else "emergent",
            "model": self.model,
            "status": status,
            "cached": cached,
            "prompt_tokens": getattr(result, "prompt_tokens", 0),
            "completion_tokens": getattr(result, "completion_tokens", 0),
            "neurons": round(float(neurons), 3),
            "latency_ms": int(getattr(result, "latency_ms", latency_ms) or latency_ms),
            "error": error,
        }
        try:
            await self.db.ai_usage_log.insert_one(doc)
        except Exception as exc:
            logger.warning("AI usage log failed: %s", str(exc)[:150])

    def _refusal(self, exc) -> EngineRefused:
        if isinstance(exc, (BudgetExceeded, Saturated)):
            return EngineRefused(exc.message, "quota" if isinstance(exc, BudgetExceeded) else "saturated")
        if isinstance(exc, ProviderError) and exc.code == "provider_quota":
            return EngineRefused(
                "Le quota gratuit d'IA est épuisé pour aujourd'hui. Il revient à minuit UTC.", "quota"
            )
        if isinstance(exc, ProviderError) and exc.code == "rate_limited":
            return EngineRefused("Neura Al Noor reçoit trop de demandes. Réessaie dans une minute.", "saturated")
        raise exc

    # ---------- inference ----------
    async def complete(self, messages, *, max_tokens=None, temperature=0.6, subject=None, source="app") -> tuple:
        """Returns (text, info) where info has tokens, neurons, cached, latency_ms."""
        if not self.provider:
            raise RuntimeError("No inference provider configured.")
        subject = subject if subject is not None else current_ai_subject.get()
        prepared = self.prepare(messages)
        max_tokens = min(int(max_tokens or self.max_output_tokens), self.max_output_tokens)
        key = self._cache_key(prepared)
        cached = await self._cache_get(key)
        if cached is not None:
            await self._log(source=source, subject=subject, status="ok", cached=True)
            return cached, {"cached": True, "neurons": 0.0, "prompt_tokens": 0, "completion_tokens": 0, "latency_ms": 0}
        worst = self.provider.max_neurons(self.model, estimate_messages_tokens(prepared), max_tokens)
        try:
            reservation = await self.budget.reserve(subject, worst)
        except BudgetExceeded as exc:
            await self._log(source=source, subject=subject, status="refused_budget", error=exc.scope)
            raise self._refusal(exc)
        try:
            async with self.gate.slot():
                result = await self.provider.chat(
                    prepared, model=self.model, max_tokens=max_tokens, temperature=temperature
                )
        except (Saturated, ProviderError) as exc:
            await self.budget.release(reservation)
            await self._log(source=source, subject=subject, status="error", error=getattr(exc, "code", "saturated"))
            raise self._refusal(exc)
        except Exception:
            await self.budget.release(reservation)
            await self._log(source=source, subject=subject, status="error", error="exception")
            raise
        await self.budget.settle(reservation, result.neurons)
        await self._log(source=source, subject=subject, status="ok", result=result, neurons=result.neurons)
        await self._cache_put(key, result.text)
        return result.text, {
            "cached": False, "neurons": result.neurons, "prompt_tokens": result.prompt_tokens,
            "completion_tokens": result.completion_tokens, "latency_ms": result.latency_ms,
        }

    async def stream(self, messages, *, max_tokens=None, temperature=0.6, subject=None, source="app"):
        """Yields ("delta", str) then ("done", info)."""
        if not self.provider:
            raise RuntimeError("No inference provider configured.")
        subject = subject if subject is not None else current_ai_subject.get()
        prepared = self.prepare(messages)
        max_tokens = min(int(max_tokens or self.max_output_tokens), self.max_output_tokens)
        key = self._cache_key(prepared)
        cached = await self._cache_get(key)
        if cached is not None:
            await self._log(source=source, subject=subject, status="ok", cached=True)
            yield ("delta", cached)
            yield ("done", {"cached": True, "neurons": 0.0, "prompt_tokens": 0, "completion_tokens": 0,
                            "latency_ms": 0, "text": cached})
            return
        worst = self.provider.max_neurons(self.model, estimate_messages_tokens(prepared), max_tokens)
        try:
            reservation = await self.budget.reserve(subject, worst)
        except BudgetExceeded as exc:
            await self._log(source=source, subject=subject, status="refused_budget", error=exc.scope)
            raise self._refusal(exc)
        result = None
        pieces: List[str] = []
        try:
            async with self.gate.slot():
                async for kind, value in self.provider.stream_chat(
                    prepared, model=self.model, max_tokens=max_tokens, temperature=temperature
                ):
                    if kind == "delta":
                        pieces.append(value)
                        yield ("delta", value)
                    else:
                        result = value
        except (Saturated, ProviderError) as exc:
            await self._log(source=source, subject=subject, status="error", error=getattr(exc, "code", "saturated"))
            if pieces:
                raise  # part of the answer was already sent (and is charged below): ordinary failure
            await self.budget.release(reservation)
            raise self._refusal(exc)
        finally:
            if result is None and reservation.neurons and pieces:
                # Client went away mid-answer: charge what was generated.
                partial = self.provider.neurons(
                    self.model, estimate_messages_tokens(prepared), estimate_tokens("".join(pieces))
                )
                await self.budget.settle(reservation, partial)
            elif result is None and reservation.neurons:
                await self.budget.release(reservation)
        if result is None:
            return
        await self.budget.settle(reservation, result.neurons)
        await self._log(source=source, subject=subject, status="ok", result=result, neurons=result.neurons)
        await self._cache_put(key, result.text)
        yield ("done", {"cached": False, "neurons": result.neurons, "prompt_tokens": result.prompt_tokens,
                        "completion_tokens": result.completion_tokens, "latency_ms": result.latency_ms,
                        "text": result.text})

    async def transcribe(self, audio: bytes, *, language=None, prompt=None, subject=None) -> str:
        subject = subject if subject is not None else current_ai_subject.get()
        worst = self.provider.stt_neurons(self.provider.audio_seconds_estimate(audio) * 1.5)
        try:
            reservation = await self.budget.reserve(subject, worst)
        except BudgetExceeded as exc:
            raise self._refusal(exc)
        try:
            async with self.gate.slot():
                text, neurons = await self.provider.transcribe(audio, language=language, prompt=prompt)
        except (Saturated, ProviderError) as exc:
            await self.budget.release(reservation)
            raise self._refusal(exc)
        except Exception:
            await self.budget.release(reservation)
            raise
        await self.budget.settle(reservation, neurons)
        await self._log(source="voice_stt", subject=subject, status="ok", neurons=neurons)
        return text

    async def speak(self, text: str, *, language: str, subject=None) -> bytes:
        subject = subject if subject is not None else current_ai_subject.get()
        neurons = self.provider.tts_neurons(text)
        try:
            reservation = await self.budget.reserve(subject, neurons)
        except BudgetExceeded as exc:
            raise self._refusal(exc)
        try:
            async with self.gate.slot():
                audio = await self.provider.speak(text, language=language)
        except (Saturated, ProviderError) as exc:
            await self.budget.release(reservation)
            raise self._refusal(exc)
        except Exception:
            await self.budget.release(reservation)
            raise
        await self._log(source="voice_tts", subject=subject, status="ok", neurons=neurons)
        return audio

    async def stats(self, days: int = 7) -> dict:
        days = max(1, min(int(days), 30))
        since = (datetime.now(timezone.utc) - timedelta(days=days - 1)).strftime("%Y-%m-%d")
        rows = await self.db.ai_usage_log.find({"day": {"$gte": since}}, {"_id": 0}).to_list(50000)
        per_day, per_source, per_subject = {}, {}, {}
        latencies, errors, cached, refused = [], 0, 0, 0
        for row in rows:
            day = per_day.setdefault(row["day"], {"requests": 0, "neurons": 0.0, "prompt_tokens": 0, "completion_tokens": 0})
            day["requests"] += 1
            day["neurons"] = round(day["neurons"] + row.get("neurons", 0.0), 3)
            day["prompt_tokens"] += row.get("prompt_tokens", 0)
            day["completion_tokens"] += row.get("completion_tokens", 0)
            per_source[row.get("source") or "?"] = per_source.get(row.get("source") or "?", 0) + 1
            if row.get("subject_kind") == "key":
                item = per_subject.setdefault(row.get("subject_id"), {"requests": 0, "neurons": 0.0})
                item["requests"] += 1
                item["neurons"] = round(item["neurons"] + row.get("neurons", 0.0), 3)
            if row.get("status") == "ok" and not row.get("cached") and row.get("latency_ms"):
                latencies.append(row["latency_ms"])
            errors += row.get("status") == "error"
            refused += row.get("status") == "refused_budget"
            cached += bool(row.get("cached"))
        latencies.sort()
        total = len(rows)
        return {
            "days": dict(sorted(per_day.items())),
            "per_source": per_source,
            "per_api_key": per_subject,
            "requests": total,
            "cache_hits": cached,
            "errors": errors,
            "refused_budget": refused,
            "error_rate": round(errors / total, 4) if total else 0.0,
            "latency_ms_p50": latencies[len(latencies) // 2] if latencies else None,
            "latency_ms_p95": latencies[int(len(latencies) * 0.95) - 1] if len(latencies) >= 20 else None,
            "budget": await self.budget.snapshot(),
            "queue": self.gate.stats(),
            "engine": self.status(),
        }


_runtime: Optional[NeuraRuntime] = None


def configure(db, provider: Optional[InferenceProvider] = None, env=os.environ, *, from_env: bool = True) -> NeuraRuntime:
    global _runtime
    if provider is None and from_env:
        provider = build_provider_from_env(env)
    _runtime = NeuraRuntime(db, provider, env)
    return _runtime


def get_runtime() -> Optional[NeuraRuntime]:
    return _runtime


class LlmChat(_LegacyLlmChat):
    """Same interface as emergentintegrations.LlmChat, routed through the Neura engine."""

    def _engine_for(self, user_message) -> Optional[NeuraRuntime]:
        runtime = get_runtime()
        if not runtime or not runtime.enabled:
            return None
        if self.tools or (user_message is not None and user_message.file_contents):
            if runtime.legacy_allowed:
                return None
            raise EngineRefused(
                "Cette fonction (images ou outils) n'est pas disponible en mode IA gratuit.", "unsupported"
            )
        return runtime

    def _engine_messages(self, user_message) -> List[dict]:
        messages = [dict(m) for m in self.messages]
        if user_message is not None and user_message.text:
            messages.append({"role": "user", "content": user_message.text})
        return messages

    def _params(self):
        return self.extra_params.get("max_tokens"), self.extra_params.get("temperature", 0.6)

    async def send_message(self, user_message):
        runtime = self._engine_for(user_message)
        if runtime is None:
            return await super().send_message(user_message)
        max_tokens, temperature = self._params()
        messages = self._engine_messages(user_message)
        text, _info = await runtime.complete(messages, max_tokens=max_tokens, temperature=temperature)
        self.messages = messages + [{"role": "assistant", "content": text}]
        return text

    async def stream_message(self, user_message=None):
        runtime = self._engine_for(user_message)
        if runtime is None:
            async for event in super().stream_message(user_message):
                yield event
            return
        max_tokens, temperature = self._params()
        messages = self._engine_messages(user_message)
        full = []
        info = {}
        async for kind, value in runtime.stream(messages, max_tokens=max_tokens, temperature=temperature):
            if kind == "delta":
                full.append(value)
                yield TextDelta(content=value)
            else:
                info = value
        text = "".join(full)
        self.messages = messages + [{"role": "assistant", "content": text}]
        yield StreamDone(
            content=text, tool_calls=None, finish_reason="stop",
            usage=Usage(input_tokens=info.get("prompt_tokens", 0), output_tokens=info.get("completion_tokens", 0),
                        total_tokens=info.get("prompt_tokens", 0) + info.get("completion_tokens", 0)),
            raw=None,
        )

    async def send_message_with_tools(self, *args, **kwargs):
        runtime = get_runtime()
        if runtime and runtime.enabled and not runtime.legacy_allowed:
            raise EngineRefused("Cette fonction (outils) n'est pas disponible en mode IA gratuit.", "unsupported")
        return await super().send_message_with_tools(*args, **kwargs)

"""Inference providers used by the Neura engine.

The Neura Gateway and the app only talk to `InferenceProvider`. Swapping
Cloudflare Workers AI for a self-hosted server (vLLM, llama.cpp, Ollama…) is a
configuration change: both speak the OpenAI chat-completions format.

    NEURA_INFERENCE_PROVIDER = emergent (default: legacy behaviour, no provider)
                             | cloudflare
                             | openai_compatible   (self-hosted engine)
"""
from __future__ import annotations

import base64
import json
import math
import os
import time
from dataclasses import dataclass
from typing import AsyncIterator, Dict, List, Optional, Tuple

import httpx

# Neurons per million tokens (input, output), from
# https://developers.cloudflare.com/workers-ai/platform/pricing/ (read 2026-10-14).
CLOUDFLARE_TEXT_NEURONS: Dict[str, Tuple[float, float]] = {
    "@cf/google/gemma-4-26b-a4b-it": (9091, 27273),
    "@cf/qwen/qwen3-30b-a3b-fp8": (4625, 30475),
    "@cf/meta/llama-3.1-8b-instruct-fp8-fast": (4119, 34868),
    "@cf/meta/llama-3.1-8b-instruct-fp8": (13778, 26128),
    "@cf/meta/llama-3.2-3b-instruct": (4625, 30475),
    "@cf/meta/llama-3.2-1b-instruct": (2457, 18252),
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast": (26668, 204805),
    "@cf/meta/llama-4-scout-17b-16e-instruct": (24545, 77273),
    "@cf/mistralai/mistral-small-3.1-24b-instruct": (31876, 50488),
    "@cf/google/gemma-3-12b-it": (31371, 50560),
    "@cf/openai/gpt-oss-20b": (18182, 27273),
    "@cf/openai/gpt-oss-120b": (31818, 68182),
    "@cf/qwen/qwen2.5-coder-32b-instruct": (60000, 90909),
    "@cf/zai-org/glm-4.7-flash": (5500, 36400),
    "@cf/ibm-granite/granite-4.0-h-micro": (1542, 10158),
}
# Neurons per audio minute.
CLOUDFLARE_WHISPER_TURBO_NEURONS_PER_MIN = 46.63
CLOUDFLARE_MELOTTS_NEURONS_PER_MIN = 18.63
CLOUDFLARE_STT_MODEL = "@cf/openai/whisper-large-v3-turbo"
CLOUDFLARE_TTS_MODEL = "@cf/myshell-ai/melotts"
# Languages MeloTTS is documented for on Workers AI ('en', 'fr' are the documented examples).
CLOUDFLARE_TTS_LANGUAGES = {"en", "fr"}


def as_text(value) -> str:
    """Cloudflare sometimes streams a number token (e.g. the "5" of "5 pillars") as a JSON
    number instead of a string; keep it as text. None and other types give ''."""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return ""


def estimate_tokens(text: str) -> int:
    """Rough multilingual estimate (≈ 3.5 characters per token), never zero."""
    return max(1, math.ceil(len(text or "") / 3.5))


def estimate_messages_tokens(messages: List[dict]) -> int:
    return sum(estimate_tokens(m.get("content") or "") + 4 for m in messages)


@dataclass
class ChatResult:
    text: str
    prompt_tokens: int
    completion_tokens: int
    neurons: float
    model: str
    provider: str
    latency_ms: int
    usage_reported: bool


class ProviderError(Exception):
    """`code` is one of: provider_quota, rate_limited, unavailable, config, bad_request."""

    def __init__(self, message: str, code: str = "unavailable", status: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.status = status


def _error_from_response(status: int, body: str) -> ProviderError:
    low = (body or "").lower()
    if any(word in low for word in ("neuron", "daily free allocation", "allocation", "4006")):
        return ProviderError("Free daily allocation of the provider is exhausted.", "provider_quota", status)
    if status == 429:
        return ProviderError("Provider rate limit reached.", "rate_limited", status)
    if status in (401, 403):
        return ProviderError("Provider credentials refused (check the API token).", "config", status)
    if 400 <= status < 500:
        return ProviderError(f"Provider rejected the request ({status}).", "bad_request", status)
    return ProviderError(f"Provider unavailable ({status}).", "unavailable", status)


class InferenceProvider:
    name = "base"
    default_model = ""

    def neurons(self, model: str, prompt_tokens: int, completion_tokens: int) -> float:
        return 0.0

    def max_neurons(self, model: str, prompt_tokens: int, max_tokens: int) -> float:
        return self.neurons(model, prompt_tokens, max_tokens)

    async def chat(self, messages, *, model, max_tokens, temperature) -> ChatResult:
        raise NotImplementedError

    def stream_chat(self, messages, *, model, max_tokens, temperature) -> AsyncIterator[Tuple[str, object]]:
        raise NotImplementedError

    supports_stt = False
    supports_tts = False


class OpenAICompatibleProvider(InferenceProvider):
    """Any server exposing POST {base_url}/chat/completions (OpenAI format)."""

    name = "openai_compatible"

    def __init__(self, base_url: str, api_key: str = "", default_model: str = "", *,
                 extra_body: Optional[dict] = None, transport: Optional[httpx.AsyncBaseTransport] = None,
                 timeout: float = 90.0, name: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.default_model = default_model
        self.extra_body = extra_body or {}
        self.transport = transport
        self.timeout = timeout
        if name:
            self.name = name

    def _client(self) -> httpx.AsyncClient:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return httpx.AsyncClient(headers=headers, timeout=self.timeout, transport=self.transport)

    def _payload(self, messages, model, max_tokens, temperature, stream):
        payload = {
            "model": model or self.default_model,
            "messages": messages,
            "max_tokens": int(max_tokens),
            "temperature": float(temperature),
            "stream": stream,
        }
        if stream:
            payload["stream_options"] = {"include_usage": True}
        payload.update(self.extra_body)
        return payload

    def _result(self, model, text, usage, messages, started) -> ChatResult:
        prompt = completion = None
        if isinstance(usage, dict):
            prompt = usage.get("prompt_tokens")
            completion = usage.get("completion_tokens")
        reported = isinstance(prompt, int) and isinstance(completion, int)
        if not reported:
            prompt = estimate_messages_tokens(messages)
            completion = estimate_tokens(text)
        return ChatResult(
            text=text,
            prompt_tokens=int(prompt),
            completion_tokens=int(completion),
            neurons=self.neurons(model, int(prompt), int(completion)),
            model=model,
            provider=self.name,
            latency_ms=int((time.monotonic() - started) * 1000),
            usage_reported=reported,
        )

    async def chat(self, messages, *, model=None, max_tokens=700, temperature=0.6) -> ChatResult:
        model = model or self.default_model
        started = time.monotonic()
        try:
            async with self._client() as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=self._payload(messages, model, max_tokens, temperature, False),
                )
        except httpx.HTTPError as exc:
            raise ProviderError(f"Provider unreachable: {type(exc).__name__}", "unavailable") from exc
        if response.status_code >= 400:
            raise _error_from_response(response.status_code, response.text)
        data = response.json()
        # Some Cloudflare endpoints wrap the payload in {"result": …}.
        if "choices" not in data and isinstance(data.get("result"), dict):
            data = data["result"]
        choices = data.get("choices") or [{}]
        text = as_text(((choices[0] or {}).get("message") or {}).get("content"))
        return self._result(model, text, data.get("usage"), messages, started)

    async def stream_chat(self, messages, *, model=None, max_tokens=700, temperature=0.6):
        """Yields ("delta", str) for each text piece, then ("done", ChatResult)."""
        model = model or self.default_model
        started = time.monotonic()
        pieces: List[str] = []
        usage = None
        try:
            async with self._client() as client:
                async with client.stream(
                    "POST", f"{self.base_url}/chat/completions",
                    json=self._payload(messages, model, max_tokens, temperature, True),
                ) as response:
                    if response.status_code >= 400:
                        body = (await response.aread()).decode("utf-8", "replace")
                        raise _error_from_response(response.status_code, body)
                    async for line in response.aiter_lines():
                        line = line.strip()
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        if chunk.get("usage"):
                            usage = chunk["usage"]
                        for choice in chunk.get("choices") or []:
                            raw_delta = choice.get("delta") or {}
                            # The model's reasoning ("thinking") is not part of the answer: it is
                            # shown apart, folded under "Réflexion en cours".
                            thought = as_text(raw_delta.get("reasoning_content") or raw_delta.get("reasoning"))
                            if thought:
                                yield ("reasoning", thought)
                            delta = as_text(raw_delta.get("content"))
                            if delta:
                                pieces.append(delta)
                                yield ("delta", delta)
                        # Native Workers AI stream format: {"response": "..."}.
                        native = as_text(chunk.get("response"))
                        if not chunk.get("choices") and native:
                            pieces.append(native)
                            yield ("delta", native)
        except httpx.HTTPError as exc:
            raise ProviderError(f"Provider unreachable: {type(exc).__name__}", "unavailable") from exc
        yield ("done", self._result(model, "".join(pieces), usage, messages, started))


class CloudflareProvider(OpenAICompatibleProvider):
    """Cloudflare Workers AI through its OpenAI-compatible endpoint."""

    name = "cloudflare"
    supports_stt = True
    supports_tts = True

    def __init__(self, account_id: str, api_token: str, default_model: str, *,
                 disable_thinking: bool = True, transport: Optional[httpx.AsyncBaseTransport] = None,
                 timeout: float = 90.0):
        self.account_id = account_id
        self.api_root = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai"
        extra = {"chat_template_kwargs": {"enable_thinking": False}} if disable_thinking else {}
        super().__init__(f"{self.api_root}/v1", api_token, default_model,
                         extra_body=extra, transport=transport, timeout=timeout)

    def neurons(self, model, prompt_tokens, completion_tokens):
        rates = CLOUDFLARE_TEXT_NEURONS.get(model)
        if rates is None:
            # Unknown model: assume the most expensive free-plan rate we list, never zero.
            rates = max(CLOUDFLARE_TEXT_NEURONS.values(), key=lambda pair: pair[1])
        return round(prompt_tokens * rates[0] / 1_000_000 + completion_tokens * rates[1] / 1_000_000, 3)

    async def _run(self, model: str, payload: dict):
        try:
            async with self._client() as client:
                response = await client.post(f"{self.api_root}/run/{model}", json=payload)
        except httpx.HTTPError as exc:
            raise ProviderError(f"Provider unreachable: {type(exc).__name__}", "unavailable") from exc
        if response.status_code >= 400:
            raise _error_from_response(response.status_code, response.text)
        return response

    @staticmethod
    def audio_seconds_estimate(audio: bytes) -> float:
        # Browser recordings are Opus at ~32 kbit/s; never under one second.
        return max(1.0, len(audio) * 8 / 32000)

    def stt_neurons(self, seconds: float) -> float:
        return round(seconds / 60 * CLOUDFLARE_WHISPER_TURBO_NEURONS_PER_MIN, 3)

    def tts_neurons(self, text: str) -> float:
        seconds = max(1.0, len(text) / 14)  # ≈ 14 spoken characters per second
        return round(seconds / 60 * CLOUDFLARE_MELOTTS_NEURONS_PER_MIN, 3)

    async def transcribe(self, audio: bytes, *, language: Optional[str] = None,
                         prompt: Optional[str] = None) -> Tuple[str, float]:
        payload = {"audio": base64.b64encode(audio).decode("ascii"), "vad_filter": True}
        if language:
            payload["language"] = language
        if prompt:
            payload["initial_prompt"] = prompt
        response = await self._run(CLOUDFLARE_STT_MODEL, payload)
        result = response.json().get("result") or {}
        info = result.get("transcription_info") or {}
        seconds = info.get("duration") if isinstance(info.get("duration"), (int, float)) else None
        seconds = seconds or self.audio_seconds_estimate(audio)
        return (result.get("text") or "").strip(), self.stt_neurons(seconds)

    async def speak(self, text: str, *, language: str = "fr") -> bytes:
        response = await self._run(CLOUDFLARE_TTS_MODEL, {"prompt": text, "lang": language})
        if response.headers.get("content-type", "").startswith("audio/"):
            return response.content
        audio = (response.json().get("result") or {}).get("audio")
        if not audio:
            raise ProviderError("No audio returned.", "unavailable", response.status_code)
        return base64.b64decode(audio)


def build_provider_from_env(env=os.environ) -> Optional[InferenceProvider]:
    kind = (env.get("NEURA_INFERENCE_PROVIDER") or "emergent").strip().lower()
    if kind == "cloudflare":
        account = (env.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
        token = (env.get("CLOUDFLARE_API_TOKEN") or "").strip()
        if not account or not token:
            raise RuntimeError("NEURA_INFERENCE_PROVIDER=cloudflare needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.")
        return CloudflareProvider(
            account, token,
            env.get("NEURA_ENGINE_MODEL") or "@cf/google/gemma-4-26b-a4b-it",
            disable_thinking=(env.get("NEURA_ENGINE_DISABLE_THINKING", "true").lower() != "false"),
        )
    if kind == "openai_compatible":
        base_url = (env.get("NEURA_ENGINE_URL") or "").strip()
        if not base_url:
            raise RuntimeError("NEURA_INFERENCE_PROVIDER=openai_compatible needs NEURA_ENGINE_URL.")
        return OpenAICompatibleProvider(
            base_url, env.get("NEURA_ENGINE_API_KEY") or "", env.get("NEURA_ENGINE_MODEL") or "neura",
        )
    return None

"""The 4 reasoning levels: real engine configurations, rights by subscription checked by the
server, kept even for a greeting, never an artificial wait."""
import asyncio
import json
import sys
import time
from pathlib import Path

import httpx
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402
import neura_engine  # noqa: E402
from neura_engine import LlmChat, UserMessage  # noqa: E402
from neura_inference import CloudflareProvider  # noqa: E402

GEMMA = "@cf/google/gemma-4-26b-a4b-it"
OSS = "@cf/openai/gpt-oss-120b"


class Fake:
    def __init__(self):
        self.bodies = []

    def __call__(self, request):
        body = json.loads(request.content)
        self.bodies.append(body)
        return httpx.Response(200, json={"choices": [{"message": {"content": "Salut ! Ça va bien, et toi ?"}}],
                                         "usage": {"prompt_tokens": 10, "completion_tokens": 8}})


def engine():
    fake = Fake()
    provider = CloudflareProvider("acc", "tok", GEMMA, transport=httpx.MockTransport(fake))
    neura_engine.configure(AsyncMongoMockClient()["levels"], provider, {}, from_env=False)
    return fake


def teardown_function():
    neura_engine.configure(AsyncMongoMockClient()["levels"], None, {}, from_env=False)


def ask(text, level, plan="vip", session="neura_stream_1"):
    subject = neura_engine.current_ai_subject.set({"kind": "user", "id": "u", "plan": plan})
    token = neura_engine.current_ai_level.set(level)
    try:
        chat = LlmChat(api_key="k", session_id=session, system_message="Tu es Neura.")
        return asyncio.run(chat.send_message(UserMessage(text=text)))
    finally:
        neura_engine.current_ai_level.reset(token)
        neura_engine.current_ai_subject.reset(subject)


def test_each_level_is_a_different_real_configuration_even_for_a_greeting():
    fake = engine()
    for level in ("instant", "medium", "high", "very_high"):
        ask("Salut, ça va ?", level)
    instant, medium, high, very_high = fake.bodies
    assert instant["model"] == GEMMA and "reasoning_effort" not in instant
    assert (medium["model"], medium["reasoning_effort"], medium["max_tokens"]) == (OSS, "low", 2500)
    assert (high["model"], high["reasoning_effort"], high["max_tokens"]) == (OSS, "medium", 5000)
    assert (very_high["model"], very_high["reasoning_effort"], very_high["max_tokens"]) == (OSS, "high", 10000)


def test_code_levels_think_more_and_auto_still_follows_the_difficulty():
    fake = engine()
    for level in ("instant", "medium", "high", "very_high", None):
        ask("Crée-moi un petit script Lua pour FiveM qui affiche un message.", level)
    efforts = [(body["model"], body["reasoning_effort"], body["max_tokens"]) for body in fake.bodies]
    assert efforts[:4] == [(OSS, "low", 6000), (OSS, "medium", 6000), (OSS, "high", 8000), (OSS, "high", 12000)]
    assert efforts[4] == (OSS, "low", 6000)  # Auto: a small script thinks little


def test_a_free_account_stays_on_instant_even_if_a_level_is_forced():
    fake = engine()
    ask("Salut, ça va ?", "very_high", plan="free")
    assert fake.bodies[0]["model"] == GEMMA and "reasoning_effort" not in fake.bodies[0]


def test_background_requests_ignore_the_conversation_level():
    fake = engine()
    ask("Je m'appelle Ali", "very_high", session="memory_1")
    assert fake.bodies[0]["model"] == GEMMA and "reasoning_effort" not in fake.bodies[0]


def test_a_reasoning_level_never_answers_from_the_cache():
    fake = engine()
    ask("Salut, ça va ?", "high")
    ask("Salut, ça va ?", "high")
    assert len(fake.bodies) == 2


def test_no_artificial_wait():
    engine()
    start = time.monotonic()
    for level in ("instant", "medium", "high", "very_high"):
        ask("Salut", level)
    assert time.monotonic() - start < 2  # the fake provider answers at once: nothing waits on purpose


def test_rights_by_subscription_are_checked_by_the_server():
    expected = {
        "free": ("instant",),
        "mongo": ("instant", "medium"),
        "pro": ("instant", "medium", "high"),
        "neura_plus": ("instant", "medium", "high", "very_high"),
        "neura_ultra": ("instant", "medium", "high", "very_high"),
    }
    for plan, allowed in expected.items():
        user = {"id": "u", "email": f"{plan}@neura-test.fr", "subscription": plan}
        for level in ("instant", "medium", "high", "very_high"):
            applied = server._allowed_reasoning_level(user, level)
            assert applied in allowed
            assert (applied == level) == (level in allowed), (plan, level, applied)
        options = {item["key"]: item["available"] for item in server._reasoning_mode_options(user)}
        assert [key for key in ("instant", "medium", "high", "very_high") if options[key]] == list(allowed)
    assert server._allowed_reasoning_level({"subscription": "mongo"}, "very_high") == "medium"
    assert server._allowed_reasoning_level({"subscription": "free"}, "auto") == "instant"
    assert server._allowed_reasoning_level({"subscription": "pro"}, "auto") == "auto"
    assert server._normalize_intelligence_mode("très élevée") == "very_high"


def test_a_plus_quota_fallback_also_lightens_the_reasoning():
    assert server._level_after_quota("very_high", {"selection_reason": "quota", "stage": "medium"}) == "medium"
    assert server._level_after_quota("high", {"selection_reason": "manual", "stage": "advanced"}) == "high"


def test_talking_about_a_project_is_a_conversation_not_a_code_task():
    from neura_engine import looks_like_code_request
    for chat in ("Tranquille moi je dev", "Sur Neura Al Noor", "Je développe une application",
                 "je code en python depuis 2 ans", "je travaille sur mon site web", "tu fais quoi ?"):
        assert not looks_like_code_request(chat), chat
    for code in ("Je développe une app, peux-tu m'aider avec le CSS ?", "je veux un script python",
                 "j'ai un bug dans mon code", "Crée-moi un site web", "corrige ce bug"):
        assert looks_like_code_request(code), code


def test_a_stopped_answer_is_charged_and_logged_never_left_open():
    import asyncio as aio

    class Slow(CloudflareProvider):
        async def stream_chat(self, messages, **kwargs):
            yield ("reasoning", "Thinking about it. " * 20)
            await aio.sleep(30)  # the answer would take long: the user stops it
            yield ("delta", "trop tard")

    db = AsyncMongoMockClient()["stop"]
    runtime = neura_engine.configure(db, Slow("acc", "tok", GEMMA), {}, from_env=False)

    async def scenario():
        token = neura_engine.current_ai_subject.set({"kind": "user", "id": "u", "plan": "vip"})
        try:
            gen = runtime.stream([{"role": "user", "content": "Développe un gros système"}], task="chat",
                                 level="very_high")
            first = await gen.__anext__()
            await gen.aclose()  # what the server does when the user presses Stop
            return first, await db.ai_usage_log.find({}, {"_id": 0}).to_list(10)
        finally:
            neura_engine.current_ai_subject.reset(token)

    start = time.monotonic()
    first, logs = asyncio.run(scenario())
    assert first[0] == "reasoning" and time.monotonic() - start < 5
    assert [row["status"] for row in logs] == ["cancelled"] and logs[0]["neurons"] > 0


def test_each_paid_offer_has_a_higher_daily_ai_limit():
    limits = [server._ai_subject({"id": "u", "subscription": plan}).get("limit")
              for plan in ("mongo", "pro", "neura_plus", "neura_ultra")]
    assert limits == sorted(limits) and len(set(limits)) == 4
    assert "limit" not in server._ai_subject({"id": "u", "subscription": "free"})


def test_the_menu_offers_styles_not_other_companies_models():
    engine()
    options = server._model_options_public({"id": "u", "email": "u@neura-test.fr", "subscription": "neura_ultra"})
    assert [option["key"] for option in options] == ["chatgpt", "claude", "gemini"]


def test_a_conversation_that_had_picked_a_catalogue_name_goes_back_to_its_style():
    engine()
    user = {"id": "u", "email": "u@neura-test.fr", "subscription": "neura_ultra"}
    public = server._resolved_model_public(user, "model:gpt-5.6-sol", "advanced")
    assert public["selection_key"] == "chatgpt" and public["label"].startswith("Neura Al Noor · style ChatGPT")

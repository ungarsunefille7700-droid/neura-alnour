"""Neura engine + Neura Gateway: budget (zero spend), queue, cache, own nan_ API keys."""
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import neura_engine  # noqa: E402
from neura_budget import BudgetExceeded, ConcurrencyGate, NeuronBudget, Saturated  # noqa: E402
from neura_engine import EngineRefused, LlmChat, UserMessage, compact_messages, user_facing_ai_error  # noqa: E402
from neura_gateway import create_gateway_routers, hash_key  # noqa: E402
from neura_inference import CloudflareProvider, OpenAICompatibleProvider, ProviderError  # noqa: E402

MODEL = "@cf/google/gemma-4-26b-a4b-it"
ENV = {"NEURA_AI_DAILY_NEURONS": "9000", "NEURA_AI_USER_NEURONS_FREE": "250"}


def run(coro):
    return asyncio.run(coro)


def fresh_db():
    return AsyncMongoMockClient()["neura_test"]


class FakeCloudflare:
    """httpx transport imitating Workers AI's OpenAI-compatible endpoint."""

    def __init__(self, answer="Wa alaykum salam !", usage=(1000, 50), status=200, error_body=""):
        self.answer, self.usage, self.status, self.error_body = answer, usage, status, error_body
        self.requests = []

    def __call__(self, request: httpx.Request):
        body = json.loads(request.content or b"{}")
        self.requests.append((str(request.url), body, dict(request.headers)))
        if self.status >= 400:
            return httpx.Response(self.status, text=self.error_body)
        usage = {"prompt_tokens": self.usage[0], "completion_tokens": self.usage[1]}
        if body.get("stream"):
            words = self.answer.split(" ")
            lines = []
            for i, word in enumerate(words):
                piece = word if i == 0 else " " + word
                lines.append("data: " + json.dumps({"choices": [{"delta": {"content": piece}}]}))
            lines.append("data: " + json.dumps({"choices": [], "usage": usage}))
            lines.append("data: [DONE]")
            return httpx.Response(200, text="\n\n".join(lines) + "\n\n",
                                  headers={"content-type": "text/event-stream"})
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": self.answer}}],
                                         "usage": usage})


def provider_with(fake):
    return CloudflareProvider("acc123", "cf-token", MODEL, transport=httpx.MockTransport(fake))


def runtime_with(fake, env=None, db=None):
    return neura_engine.configure(db or fresh_db(), provider_with(fake), {**ENV, **(env or {})}, from_env=False)


# ---------------------------------------------------------------- provider
def test_cloudflare_request_and_neuron_cost_follow_the_official_rates():
    fake = FakeCloudflare(usage=(1000, 100))
    result = run(provider_with(fake).chat([{"role": "user", "content": "Salam"}], max_tokens=200, temperature=0.5))
    url, body, headers = fake.requests[0]
    assert url == "https://api.cloudflare.com/client/v4/accounts/acc123/ai/v1/chat/completions"
    assert headers["authorization"] == "Bearer cf-token"
    assert body["model"] == MODEL and body["max_tokens"] == 200
    assert body["chat_template_kwargs"] == {"enable_thinking": False}  # no paid-for hidden reasoning tokens
    # 1000 × 9091/1M + 100 × 27273/1M
    assert result.neurons == pytest.approx(9.091 + 2.7273, abs=0.001)
    assert result.usage_reported is True


def test_streaming_is_parsed_and_usage_kept():
    fake = FakeCloudflare(answer="La prière du matin", usage=(500, 4))

    async def collect():
        out = []
        async for kind, value in provider_with(fake).stream_chat([{"role": "user", "content": "x"}], max_tokens=50):
            out.append((kind, value))
        return out

    events = run(collect())
    assert "".join(v for k, v in events if k == "delta") == "La prière du matin"
    done = events[-1][1]
    assert done.prompt_tokens == 500 and done.completion_tokens == 4


def test_the_model_reasoning_is_kept_apart_from_the_answer():
    def thinking(request):
        lines = ["data: " + json.dumps({"choices": [{"delta": {"reasoning_content": "Il veut un quiz. "}}]}),
                 "data: " + json.dumps({"choices": [{"delta": {"reasoning_content": "3 fichiers."}}]}),
                 "data: " + json.dumps({"choices": [{"delta": {"content": "Je vais créer un quiz."}}]}),
                 "data: " + json.dumps({"choices": [], "usage": {"prompt_tokens": 10, "completion_tokens": 20}}),
                 "data: [DONE]"]
        return httpx.Response(200, text="\n\n".join(lines) + "\n\n")

    neura_engine.configure(fresh_db(), CloudflareProvider("a", "t", MODEL, transport=httpx.MockTransport(thinking)),
                           ENV, from_env=False)
    chat = LlmChat(api_key="k", session_id="neura_stream_t", system_message="sys")

    async def collect():
        return [e async for e in chat.stream_message(UserMessage(text="Crée un quiz en HTML"))]

    events = run(collect())
    names = [e.__class__.__name__ for e in events]
    assert names == ["ThinkingDelta", "ThinkingDelta", "TextDelta", "StreamDone"]
    assert "".join(e.thinking for e in events[:2]) == "Il veut un quiz. 3 fichiers."
    assert events[-1].content == "Je vais créer un quiz."  # the reasoning is not part of the answer


def test_numbers_streamed_as_json_numbers_are_kept_as_text():
    # Seen live on @cf/qwen/qwen3-30b-a3b-fp8: {"delta": {"content": 5}} for "5 pillars".
    def numeric(request):
        lines = ["data: " + json.dumps({"choices": [{"delta": {"content": piece}}]}) for piece in ("Les ", 5, " piliers, ", 0, " doute")]
        lines += ["data: " + json.dumps({"choices": [], "usage": {"prompt_tokens": 3, "completion_tokens": 5}}), "data: [DONE]"]
        return httpx.Response(200, text="\n\n".join(lines) + "\n\n")

    async def collect():
        provider = CloudflareProvider("acc", "tok", MODEL, transport=httpx.MockTransport(numeric))
        return [e async for e in provider.stream_chat([{"role": "user", "content": "x"}])]

    events = run(collect())
    assert events[-1][1].text == "Les 5 piliers, 0 doute"

    def numeric_full(request):
        return httpx.Response(200, json={"choices": [{"message": {"content": 42}}]})

    provider = CloudflareProvider("acc", "tok", MODEL, transport=httpx.MockTransport(numeric_full))
    assert run(provider.chat([{"role": "user", "content": "x"}])).text == "42"


def test_provider_errors_are_classified():
    exhausted = FakeCloudflare(status=429, error_body='{"errors":[{"message":"you have used up your daily free allocation of 10,000 neurons"}]}')
    with pytest.raises(ProviderError) as info:
        run(provider_with(exhausted).chat([{"role": "user", "content": "x"}]))
    assert info.value.code == "provider_quota"
    with pytest.raises(ProviderError) as info:
        run(provider_with(FakeCloudflare(status=403, error_body="bad token")).chat([{"role": "user", "content": "x"}]))
    assert info.value.code == "config"


def test_self_hosted_engine_uses_the_same_interface():
    fake = FakeCloudflare(answer="ok")
    provider = OpenAICompatibleProvider("http://my-gpu:8000/v1", "secret", "qwen3.5-9b",
                                        transport=httpx.MockTransport(fake))
    result = run(provider.chat([{"role": "user", "content": "x"}]))
    assert fake.requests[0][0] == "http://my-gpu:8000/v1/chat/completions"
    assert "chat_template_kwargs" not in fake.requests[0][1]
    assert result.text == "ok" and result.neurons == 0


# ---------------------------------------------------------------- history compaction
def test_long_conversations_keep_recent_turns_and_a_digest_of_older_ones():
    messages = [{"role": "system", "content": "Tu es Neura."}]
    for i in range(30):
        messages.append({"role": "user", "content": f"question {i} " + "détail " * 40})
        messages.append({"role": "assistant", "content": f"réponse {i}"})
    compact = compact_messages(messages, keep_last=6, older_chars=40, older_items=4, max_input_tokens=10_000)
    assert compact[0]["role"] == "system" and compact[0]["content"].startswith("Tu es Neura.")
    assert "résumé des anciens échanges" in compact[0]["content"]
    assert "question 26" in compact[0]["content"]  # most recent older turns are summarised
    assert [m["content"] for m in compact[1:]][-1] == "réponse 29"
    assert len(compact) == 7
    tight = compact_messages(messages, keep_last=6, older_chars=40, older_items=4, max_input_tokens=200)
    assert tight[-1]["content"] == "réponse 29" and len(tight) < 7


# ---------------------------------------------------------------- budget (zero spend)
def test_budget_refuses_before_the_free_allocation_is_exceeded():
    db = fresh_db()
    budget = NeuronBudget(db, daily_limit=100, plan_limits={"free": 60, "paid": None}, free_share=0.7)
    alice = {"kind": "user", "id": "alice", "plan": "free"}
    bob = {"kind": "user", "id": "bob", "plan": "paid"}

    async def scenario():
        first = await budget.reserve(alice, 50)
        await budget.settle(first, 20)  # real cost lower than the reserved worst case
        with pytest.raises(BudgetExceeded) as personal:
            await budget.reserve(alice, 45)  # 20 + 45 > 60 (personal free limit)
        assert personal.value.scope == "subject"
        await budget.reserve({"kind": "user", "id": "carol", "plan": "free"}, 50)  # global 70 = free share
        with pytest.raises(BudgetExceeded) as shared:
            await budget.reserve({"kind": "user", "id": "dan", "plan": "free"}, 1)
        assert shared.value.scope == "global"
        paid = await budget.reserve(bob, 30)  # paid users can still use the last 30 %
        with pytest.raises(BudgetExceeded):
            await budget.reserve(bob, 1)
        await budget.release(paid)
        return await budget.snapshot(alice)

    snap = run(scenario())
    assert snap["used"] == pytest.approx(70)
    assert snap["subject"]["used"] == pytest.approx(20)
    assert snap["reset_at"].endswith("+00:00")


def test_budget_resets_with_the_utc_day():
    db = fresh_db()
    now = [datetime(2026, 10, 14, 23, 59, tzinfo=timezone.utc)]
    budget = NeuronBudget(db, daily_limit=10, plan_limits={"free": None}, clock=lambda: now[0])

    async def scenario():
        await budget.reserve(None, 10)
        with pytest.raises(BudgetExceeded):
            await budget.reserve(None, 1)
        now[0] = datetime(2026, 10, 15, 0, 1, tzinfo=timezone.utc)
        await budget.reserve(None, 10)

    run(scenario())


# ---------------------------------------------------------------- saturation
def test_queue_waits_then_refuses_when_full():
    async def scenario():
        gate = ConcurrencyGate(max_concurrent=1, max_queue=1, queue_timeout=0.2, rpm_limit=100)
        release = asyncio.Event()

        async def hold():
            async with gate.slot():
                await release.wait()

        holder = asyncio.create_task(hold())
        await asyncio.sleep(0)
        waiter = asyncio.create_task(hold())
        await asyncio.sleep(0)
        with pytest.raises(Saturated):  # queue (1) is full
            async with gate.slot():
                pass
        release.set()
        await asyncio.gather(holder, waiter)
        timeout_gate = ConcurrencyGate(max_concurrent=1, max_queue=5, queue_timeout=0.05, rpm_limit=100)
        blocker = asyncio.Event()

        async def hold2():
            async with timeout_gate.slot():
                await blocker.wait()

        task = asyncio.create_task(hold2())
        await asyncio.sleep(0)
        with pytest.raises(Saturated):  # waited too long
            async with timeout_gate.slot():
                pass
        blocker.set()
        await task
        return gate.stats()

    stats = run(scenario())
    assert stats["rejected"] == 1 and stats["served"] == 2


def test_requests_per_minute_are_capped():
    async def scenario():
        gate = ConcurrencyGate(max_concurrent=5, max_queue=5, queue_timeout=1, rpm_limit=2)
        for _ in range(2):
            async with gate.slot():
                pass
        with pytest.raises(Saturated):
            async with gate.slot():
                pass

    run(scenario())


# ---------------------------------------------------------------- runtime
def test_runtime_caches_first_questions_and_logs_usage():
    fake = FakeCloudflare(answer="Les cinq piliers sont…")
    runtime = runtime_with(fake)
    msgs = [{"role": "system", "content": "Tu es Neura."}, {"role": "user", "content": "Quels sont les piliers ?"}]
    subject = {"kind": "user", "id": "u1", "plan": "free"}

    async def scenario():
        first = await runtime.complete(msgs, subject=subject)
        again = await runtime.complete(
            [msgs[0], {"role": "user", "content": "  quels sont les PILIERS ? "}], subject=subject)
        stats = await runtime.stats(1)
        return first, again, stats

    first, again, stats = run(scenario())
    assert len(fake.requests) == 1  # the second identical question did not reach Cloudflare
    assert first[0] == again[0] and again[1]["cached"] is True
    assert stats["requests"] == 2 and stats["cache_hits"] == 1
    assert stats["budget"]["used"] == pytest.approx(first[1]["neurons"], abs=0.01)


def test_runtime_refuses_without_calling_the_provider_when_budget_is_gone():
    fake = FakeCloudflare()
    runtime = runtime_with(fake, {"NEURA_AI_DAILY_NEURONS": "1"})
    with pytest.raises(EngineRefused) as info:
        run(runtime.complete([{"role": "user", "content": "Salam " * 50}], subject={"kind": "user", "id": "x", "plan": "vip"}))
    assert fake.requests == []
    assert info.value.code == "quota"
    assert "minuit UTC" in user_facing_ai_error(info.value)


def test_an_abandoned_request_gives_its_reservation_back():
    # Seen on 2026-10-15: the quiz gave up after its timeout (asyncio.wait_for cancels the
    # call); the reserved worst case was never released and the day's budget leaked.
    async def slow(request):
        await asyncio.sleep(5)
        return httpx.Response(200, json={"choices": [{"message": {"content": "trop tard"}}]})

    runtime = neura_engine.configure(fresh_db(), CloudflareProvider("a", "t", MODEL, transport=httpx.MockTransport(slow)),
                                     ENV, from_env=False)

    async def scenario():
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(runtime.complete([{"role": "user", "content": "x"}],
                                                    subject={"kind": "user", "id": "q", "plan": "free"}), timeout=0.2)
        return await runtime.budget.snapshot({"kind": "user", "id": "q", "plan": "free"})

    snap = run(scenario())
    assert snap["used"] == 0
    assert snap["subject"]["used"] == 0


def test_cloudflare_exhaustion_becomes_a_clear_refusal_and_frees_the_reservation():
    runtime = runtime_with(FakeCloudflare(status=429, error_body="daily free allocation exhausted"))
    with pytest.raises(EngineRefused):
        run(runtime.complete([{"role": "user", "content": "x"}], subject={"kind": "user", "id": "x", "plan": "free"}))
    assert run(runtime.budget.snapshot())["used"] == 0


# ---------------------------------------------------------------- drop-in LlmChat
def test_llmchat_uses_the_engine_with_the_app_history(monkeypatch):
    fake = FakeCloudflare(answer="Réponse du moteur")
    runtime_with(fake)
    token = neura_engine.current_ai_subject.set({"kind": "user", "id": "u9", "plan": "paid"})
    try:
        chat = LlmChat(api_key="unused", session_id="s", system_message="Tu es Neura.", initial_messages=[
            {"role": "system", "content": "Tu es Neura."},
            {"role": "user", "content": "Salam"},
            {"role": "assistant", "content": "Wa alaykum salam"},
        ]).with_model("gemini", "gemini-2.5-flash").with_params(max_tokens=300, temperature=0.4)

        async def scenario():
            text = await chat.send_message(UserMessage(text="Et la prière ?"))
            streamed = [e async for e in chat.stream_message(UserMessage(text="Merci"))]
            return text, streamed

        text, streamed = run(scenario())
    finally:
        neura_engine.current_ai_subject.reset(token)
    body = fake.requests[0][1]
    assert text == "Réponse du moteur"
    assert [m["role"] for m in body["messages"]] == ["system", "user", "assistant", "user"]
    assert body["max_tokens"] == 300 and body["temperature"] == 0.4
    assert streamed[-1].__class__.__name__ == "StreamDone" and streamed[-1].content == "Réponse du moteur"
    assert run(neura_engine.get_runtime().budget.snapshot({"kind": "user", "id": "u9", "plan": "paid"}))["subject"]["requests"] == 2


def test_programming_requests_use_the_code_model_with_room_for_whole_files():
    fake = FakeCloudflare(answer="Fichier: app.py\n```python\nprint('salam')\n```")
    runtime_with(fake)
    token = neura_engine.current_ai_subject.set({"kind": "user", "id": "p1", "plan": "paid"})
    try:
        chat = LlmChat(api_key="k", session_id="neura_stream_1", system_message="Tu es Neura.") \
            .with_model("gemini", "gemini-2.5-flash").with_params(max_tokens=600)
        run(chat.send_message(UserMessage(text="Crée-moi un script Python qui affiche salam, dans un zip")))
        run(chat.send_message(UserMessage(text="Quelles sont les conditions de la prière ?")))
        dev = LlmChat(api_key="k", session_id="dev_42", system_message="Tu es Neura Dev.")
        run(dev.send_message(UserMessage(text="Et maintenant ?")))
    finally:
        neura_engine.current_ai_subject.reset(token)
    token = neura_engine.current_ai_subject.set({"kind": "user", "id": "f1", "plan": "free"})
    try:
        free = LlmChat(api_key="k", session_id="neura_stream_2", system_message="Tu es Neura.")
        run(free.send_message(UserMessage(text="Crée-moi un site web en HTML")))
    finally:
        neura_engine.current_ai_subject.reset(token)
    code, religion, workspace, free_code = (body for _, body, _ in fake.requests)
    # Measured best for whole projects; free accounts get gemma-4 (fits their daily limit).
    assert code["model"] == "@cf/openai/gpt-oss-120b" and code["max_tokens"] == 6000
    assert religion["model"] == MODEL and religion["max_tokens"] == 600
    assert workspace["model"] == "@cf/openai/gpt-oss-120b"
    assert free_code["model"] == "@cf/google/gemma-4-26b-a4b-it"


def test_asking_for_a_zip_puts_the_correction_next_to_the_question_but_not_in_history():
    fake = FakeCloudflare(answer="Oui, voici le projet.")
    runtime_with(fake)
    chat = LlmChat(api_key="k", session_id="neura_stream_9", system_message="Tu es Neura.", initial_messages=[
        {"role": "system", "content": "Tu es Neura."},
        {"role": "user", "content": "tu sais faire un zip ?"},
        {"role": "assistant", "content": "Je ne peux pas créer de fichier .zip."},
    ])
    run(chat.send_message(UserMessage(text="normalement là tu peux envoyer des fichiers zip")))
    sent = fake.requests[0][1]["messages"][-1]["content"]
    assert sent.startswith("normalement là tu peux envoyer des fichiers zip")
    assert "Tu PEUX donc livrer un zip" in sent
    assert chat.messages[-2] == {"role": "user", "content": "normalement là tu peux envoyer des fichiers zip"}
    run(chat.send_message(UserMessage(text="Merci, et la prière du soir ?")))
    assert "Tu PEUX" not in fake.requests[1][1]["messages"][-1]["content"]


def test_the_quiz_generator_is_not_mistaken_for_a_code_request():
    # Regression seen on 2026-10-15: the quiz prompt says "JSON", it was sent to the slow
    # code model and capped, timed out, and the app fell back to the built-in questions.
    fake = FakeCloudflare(answer='[{"question": "?", "options": ["a","b","c","d"], "correct_answer": 0}]')
    runtime_with(fake)
    quiz = LlmChat(api_key="k", session_id="quiz_gen_1", system_message="Tu retournes uniquement du JSON valide.") \
        .with_model("openai", "gpt-4.1-mini").with_params(max_tokens=4096, temperature=1.0)
    run(quiz.send_message(UserMessage(text="Génère exactement 10 questions. Retourne UNIQUEMENT un tableau JSON valide.")))
    body = fake.requests[0][1]
    assert body["model"] == MODEL  # the main model, not the code model
    assert body["max_tokens"] == 4096  # the length the quiz asks for, not the 700 chat cap
    tutor = LlmChat(api_key="k", session_id="lang_stream_1", system_message="Professeur")
    run(tutor.send_message(UserMessage(text="Explique-moi le mot code en anglais")))
    assert fake.requests[1][1]["model"] == MODEL


def test_reasoning_effort_is_proportional_to_the_request_or_the_chosen_level():
    fake = FakeCloudflare(answer="ok")
    runtime_with(fake)
    subject = neura_engine.current_ai_subject.set({"kind": "user", "id": "v", "plan": "vip"})
    try:
        def ask(text, level=None):
            token = neura_engine.current_ai_level.set(level)
            try:
                chat = LlmChat(api_key="k", session_id="neura_stream_e", system_message="Tu es Neura.")
                run(chat.send_message(UserMessage(text=text)))
            finally:
                neura_engine.current_ai_level.reset(token)
            return fake.requests[-1][1]

        small = ask("Crée-moi un petit script Lua pour FiveM qui affiche un message de bienvenue.")
        project = ask("Développe un système complet de gestion d'entreprises pour FiveM avec une interface NUI, "
                      "des scripts client et serveur et une base de données SQL.")
        chosen = ask("Crée-moi un petit script Lua pour FiveM.", level="high")
        question = ask("Explique-moi ce qu'est une API.")
    finally:
        neura_engine.current_ai_subject.reset(subject)
    assert small["model"] == "@cf/openai/gpt-oss-120b" and small["reasoning_effort"] == "low"
    assert project["reasoning_effort"] == "high"
    assert chosen["reasoning_effort"] == "high"  # the level chosen by the user wins
    assert question["model"] == MODEL and "reasoning_effort" not in question  # a question, not code


def test_code_detection():
    from neura_engine import looks_like_code_request
    for text in ("tu sais faire du code puis les mettre dans un zip ?", "Crée-moi un site web", "corrige ce bug",
                 "```js\nlet a\n```", "une API FastAPI"):
        assert looks_like_code_request(text), text
    for text in ("Quelles sont les conditions de la prière ?", "Explique la sourate Al-Fatiha", "Salam, ça va ?",
                 "Explique-moi ce qu'est une API.", "C'est quoi la différence entre Python et JavaScript ?"):
        assert not looks_like_code_request(text), text


def test_llmchat_keeps_the_legacy_path_when_no_engine_is_configured(monkeypatch):
    neura_engine.configure(fresh_db(), None, {}, from_env=False)
    calls = []

    async def legacy_send(self, message):
        calls.append(message.text)
        return "legacy"

    monkeypatch.setattr(neura_engine._LegacyLlmChat, "send_message", legacy_send)
    chat = LlmChat(api_key="k", session_id="s", system_message="sys")
    assert run(chat.send_message(UserMessage(text="hi"))) == "legacy"
    assert calls == ["hi"]


def test_strict_free_mode_refuses_what_the_engine_cannot_do():
    runtime_with(FakeCloudflare(), {"NEURA_LEGACY_AI": "off"})
    chat = LlmChat(api_key="k", session_id="s", system_message="sys")
    image = neura_engine.FileContent(content_type="image", file_content_base64="aGk=")
    with pytest.raises(EngineRefused) as info:
        run(chat.send_message(UserMessage(text="décris", file_contents=[image])))
    assert "mode IA gratuit" in info.value.user_message


# ---------------------------------------------------------------- gateway
ADMIN = {"id": "admin-1", "email": "founder@neura.test", "role": "founder"}
USER = {"id": "user-1", "email": "user@neura.test"}


def gateway_app(fake, env=None):
    db = fresh_db()
    runtime_with(fake, env, db)
    current = {"user": ADMIN}

    async def get_current_user(request: Request):
        if not request.headers.get("authorization", "").startswith("Bearer session"):
            raise HTTPException(status_code=401, detail="Non authentifié")
        return current["user"]

    async def require_admin(user):
        if user.get("role") != "founder":
            raise HTTPException(status_code=403, detail="Acces reserve")

    public, admin, ensure_indexes = create_gateway_routers(
        db=db, get_current_user=get_current_user, require_admin=require_admin, pepper="p" * 32)
    app = FastAPI()
    app.include_router(public)
    app.include_router(admin)
    run(ensure_indexes())
    return TestClient(app), db, current


SESSION = {"Authorization": "Bearer session"}


def create_key(client, **limits):
    response = client.post("/api/gateway/keys", json={"name": "NeuraCo", **limits}, headers=SESSION)
    assert response.status_code == 200, response.text
    return response.json()


def test_admin_creates_a_nan_key_shown_once_and_stored_hashed():
    client, db, _ = gateway_app(FakeCloudflare())
    created = create_key(client)
    secret = created["key"]
    assert secret.startswith("nan_") and len(secret) > 40
    stored = run(db.api_keys.find_one({"id": created["api_key"]["id"]}))
    assert stored["hash"] == hash_key(secret, "p" * 32)
    assert secret not in json.dumps({k: v for k, v in stored.items() if k != "_id"}, default=str)
    listed = client.get("/api/gateway/keys", headers=SESSION).json()
    assert "hash" not in listed[0] and "key" not in listed[0]
    assert listed[0]["prefix"] == secret[:10]


def test_only_admins_manage_keys():
    client, _, current = gateway_app(FakeCloudflare())
    current["user"] = USER
    assert client.post("/api/gateway/keys", json={"name": "x"}, headers=SESSION).status_code == 403
    assert client.get("/api/gateway/keys").status_code == 401


def test_chat_completion_with_own_key_hides_the_provider():
    fake = FakeCloudflare(answer="Salam, je suis Neura Al Noor.")
    client, _, _ = gateway_app(fake)
    secret = create_key(client)["key"]
    response = client.post("/v1/chat/completions", headers={"Authorization": f"Bearer {secret}"},
                           json={"model": "neura-al-noor", "messages": [{"role": "user", "content": "Qui es-tu ?"}]})
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["object"] == "chat.completion" and data["model"] == "neura-al-noor"
    assert data["choices"][0]["message"]["content"] == "Salam, je suis Neura Al Noor."
    assert data["usage"]["neurons"] > 0
    assert client.get("/v1/models", headers={"X-API-Key": secret}).json()["data"][0]["id"] == "neura-al-noor"
    usage = client.get("/v1/usage", headers={"X-API-Key": secret}).json()
    assert usage["today"]["requests"] == 1


def test_streaming_follows_the_openai_format():
    client, _, _ = gateway_app(FakeCloudflare(answer="Un deux trois"))
    secret = create_key(client)["key"]
    with client.stream("POST", "/v1/chat/completions", headers={"Authorization": f"Bearer {secret}"},
                       json={"stream": True, "messages": [{"role": "user", "content": "Compte"}]}) as response:
        assert response.status_code == 200
        lines = [line for line in response.iter_lines() if line.startswith("data: ")]
    assert lines[-1] == "data: [DONE]"
    chunks = [json.loads(line[6:]) for line in lines[:-1]]
    text = "".join(c["choices"][0]["delta"].get("content", "") for c in chunks)
    assert text == "Un deux trois"
    assert chunks[-1]["choices"][0]["finish_reason"] == "stop" and chunks[-1]["usage"]["neurons"] > 0


def test_invalid_revoked_and_brute_forced_keys_are_refused():
    client, _, _ = gateway_app(FakeCloudflare())
    created = create_key(client)
    body = {"messages": [{"role": "user", "content": "x"}]}
    assert client.post("/v1/chat/completions", json=body).status_code == 401
    assert client.post("/v1/chat/completions", json=body, headers={"X-API-Key": "nan_wrong"}).json()["error"]["code"] == "invalid_api_key"
    assert client.post(f"/api/gateway/keys/{created['api_key']['id']}/revoke", headers=SESSION).status_code == 200
    revoked = client.post("/v1/chat/completions", json=body, headers={"X-API-Key": created["key"]})
    assert revoked.status_code == 401 and revoked.json()["error"]["code"] == "revoked_api_key"
    for _ in range(20):
        client.post("/v1/chat/completions", json=body, headers={"X-API-Key": "nan_guess"})
    blocked = client.post("/v1/chat/completions", json=body, headers={"X-API-Key": "nan_guess"})
    assert blocked.status_code == 429 and blocked.json()["error"]["code"] == "auth_blocked"


def test_per_key_rate_and_daily_quota():
    fake = FakeCloudflare(usage=(1000, 50))
    client, _, _ = gateway_app(fake)
    secret = create_key(client, requests_per_minute=2, daily_neurons=30)["key"]
    headers = {"X-API-Key": secret}
    body = {"messages": [{"role": "user", "content": "x"}], "max_tokens": 50}
    assert client.post("/v1/chat/completions", json=body, headers=headers).status_code == 200
    assert client.post("/v1/chat/completions", json=body, headers=headers).status_code == 200
    limited = client.post("/v1/chat/completions", json=body, headers=headers)
    assert limited.status_code == 429 and limited.json()["error"]["code"] == "rate_limit_exceeded"

    small = create_key(client, daily_neurons=1)["key"]
    refused = client.post("/v1/chat/completions", json=body, headers={"X-API-Key": small})
    assert refused.status_code == 429 and refused.json()["error"]["type"] == "insufficient_quota"


def test_requests_are_validated():
    client, _, _ = gateway_app(FakeCloudflare())
    secret = create_key(client)["key"]
    headers = {"X-API-Key": secret}
    assert client.post("/v1/chat/completions", headers=headers, json={"messages": []}).status_code == 422
    too_long = {"messages": [{"role": "user", "content": "a" * 40_001}]}
    assert client.post("/v1/chat/completions", headers=headers, json=too_long).status_code == 422


def test_admin_stats_report_usage_budget_and_queue():
    client, _, _ = gateway_app(FakeCloudflare())
    secret = create_key(client)["key"]
    client.post("/v1/chat/completions", headers={"X-API-Key": secret},
                json={"messages": [{"role": "user", "content": "x"}]})
    stats = client.get("/api/gateway/stats", headers=SESSION).json()
    assert stats["enabled"] is True and stats["requests"] == 1
    assert stats["per_source"] == {"api": 1}
    assert stats["budget"]["daily_limit"] == 9000 and stats["queue"]["served"] == 1
    status = client.get("/api/gateway/status", headers=SESSION).json()
    assert status["engine"]["provider"] == "cloudflare"

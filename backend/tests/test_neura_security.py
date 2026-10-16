"""Security fixes before launch: founder addresses, login attempts, weak passwords, signing
secret, anonymous quiz budget, free image limit under parallel requests, model labels."""
import asyncio
import sys
from pathlib import Path

import httpx
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402
import neura_engine  # noqa: E402
from neura_budget import NeuronBudget  # noqa: E402
from neura_inference import CloudflareProvider  # noqa: E402


def client(monkeypatch):
    monkeypatch.setattr(server, "db", AsyncMongoMockClient()["security"])
    server._RATE_BUCKETS.clear()
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def run(coro):
    return asyncio.run(coro)


def test_signing_secret_is_never_the_old_default():
    assert server.JWT_SECRET != "neura_alnour_secret" and len(server.JWT_SECRET) >= 32


def test_a_founder_address_cannot_be_registered_with_a_password(monkeypatch):
    async def scenario():
        async with client(monkeypatch) as c:
            founder = sorted(server.FOUNDER_EMAILS)[0]
            r = await c.post("/api/auth/register", json={"email": founder, "password": "Password!2026", "name": "x"})
            return r.status_code, await server.db.users.count_documents({})
    status, users = run(scenario())
    assert status == 403 and users == 0


def test_weak_password_is_refused(monkeypatch):
    async def scenario():
        async with client(monkeypatch) as c:
            r = await c.post("/api/auth/register", json={"email": "a@neura-test.fr", "password": "123", "name": "a"})
            return r.status_code
    assert run(scenario()) == 422


def test_login_attempts_are_limited(monkeypatch):
    async def scenario():
        async with client(monkeypatch) as c:
            await c.post("/api/auth/register", json={"email": "b@neura-test.fr", "password": "Password!2026", "name": "b"})
            codes = [(await c.post("/api/auth/login", json={"email": "b@neura-test.fr", "password": "wrong-pass"})).status_code
                     for _ in range(9)]
            good = await c.post("/api/auth/login", json={"email": "b@neura-test.fr", "password": "Password!2026"})
            return codes, good.status_code
    codes, good = run(scenario())
    assert codes[:8] == [401] * 8 and codes[8] == 429
    assert good == 429  # even the right password waits: the attacker cannot keep guessing


def test_a_good_login_is_not_slowed_down(monkeypatch):
    async def scenario():
        async with client(monkeypatch) as c:
            await c.post("/api/auth/register", json={"email": "c@neura-test.fr", "password": "Password!2026", "name": "c"})
            return [(await c.post("/api/auth/login", json={"email": "c@neura-test.fr", "password": "Password!2026"})).status_code
                    for _ in range(12)]
    assert set(run(scenario())) == {200}


def test_anonymous_calls_only_get_the_free_share():
    budget = NeuronBudget(None, daily_limit=1000, plan_limits={"free": 100}, free_share=0.7)
    assert budget.global_cap({"kind": "anon", "id": "ip:1", "plan": "free", "limit": 40}) == 700
    assert budget.subject_limit({"kind": "anon", "id": "ip:1", "plan": "free", "limit": 40}) == 40


def test_free_images_cannot_be_overused_in_parallel(monkeypatch):
    calls = []

    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"images": [{"image_url": {"url": "data:image/png;base64,AAAA"}}]}}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            calls.append(1)
            await asyncio.sleep(0.05)
            return FakeResponse()

    async def scenario():
        db = AsyncMongoMockClient()["images"]
        monkeypatch.setattr(server, "db", db)
        monkeypatch.setattr(server.httpx, "AsyncClient", FakeClient)
        monkeypatch.setattr(server, "_require_legacy_ai", lambda feature: None)
        user = {"id": "u1", "email": "u1@neura-test.fr", "subscription": "free", "image_generations_count": 2}
        await db.users.insert_one(dict(user))
        request = server.ImageGenerateRequest(prompt="une mosquée au coucher du soleil")
        outcomes = await asyncio.gather(*(server.generate_image(request, user) for _ in range(5)),
                                        return_exceptions=True)
        count = (await db.users.find_one({"id": "u1"}))["image_generations_count"]
        return outcomes, count

    outcomes, count = run(scenario())
    assert sum(1 for item in outcomes if isinstance(item, dict)) == 1  # only the 3rd image goes through
    assert count == 3 and len(calls) == 1


def test_the_engine_is_never_presented_as_another_company_model():
    provider = CloudflareProvider("acc", "tok", "@cf/google/gemma-4-26b-a4b-it",
                                  transport=httpx.MockTransport(lambda request: httpx.Response(500)))
    neura_engine.configure(AsyncMongoMockClient()["labels"], provider, {}, from_env=False)
    try:
        public = server._resolved_model_public({"id": "u", "subscription": "free"}, "chatgpt", "advanced")
    finally:
        neura_engine.configure(AsyncMongoMockClient()["labels"], None, {}, from_env=False)
    assert "GPT-4o" not in public["label"] and public["label"].startswith("Neura Al Noor · style ChatGPT")
    assert public["provider_display_name"] == "Neura Al Noor"


def test_data_export_has_everything_but_secrets(monkeypatch):
    async def scenario():
        db = AsyncMongoMockClient()["export"]
        monkeypatch.setattr(server, "db", db)
        server._RATE_BUCKETS.clear()
        await db.users.insert_one({"id": "u1", "email": "u1@neura-test.fr", "name": "U", "password": "HASH",
                                   "two_factor_secret": "SECRET"})
        await db.ai_memories.insert_one({"id": "m1", "user_id": "u1", "value": "Habite à Lyon."})
        await db.messages.insert_one({"id": "x", "user_id": "u1", "role": "user", "content": "salam"})
        await db.messages.insert_one({"id": "y", "user_id": "u2", "role": "user", "content": "autre compte"})
        response = await server.export_account_data({"id": "u1"})
        return response.body.decode()
    body = run(scenario())
    assert "Habite à Lyon." in body and "salam" in body
    assert "HASH" not in body and "SECRET" not in body and "autre compte" not in body


def test_memory_switched_off_is_neither_saved_nor_used(monkeypatch):
    async def scenario():
        db = AsyncMongoMockClient()["memoff"]
        monkeypatch.setattr(server, "db", db)
        await db.ai_memories.insert_one({"id": "m1", "user_id": "u1", "value": "Habite à Lyon.",
                                         "created_at": "2026-08-04T10:00:00+00:00", "updated_at": "2026-08-04T10:00:00+00:00"})
        user = {"id": "u1", "subscription": "free", "memory_enabled": False}
        context = await server._ai_memory_context(user, "où j'habite ?")
        saved = await server._save_ai_memory_from_text(user, "Souviens-toi que j'aime le thé")
        return context, saved, await db.ai_memories.count_documents({})
    context, saved, count = run(scenario())
    assert context == "" and saved is None and count == 1


def test_deleting_the_account_stops_the_subscription(monkeypatch):
    cancelled = []

    class Subs:
        async def cancel_async(self, subscription_id):
            cancelled.append(subscription_id)

    class Fake:
        v1 = type("V1", (), {"subscriptions": Subs()})()

    async def scenario():
        db = AsyncMongoMockClient()["delete"]
        monkeypatch.setattr(server, "db", db)
        monkeypatch.setattr(server, "_stripe_client", lambda: Fake())
        await db.users.insert_one({"id": "u1", "email": "u1@neura-test.fr", "password": server.hash_password("Password!2026"),
                                   "stripe_subscription_id": "sub_1", "subscription_status": "active"})
        request = server.AccountDeletionRequest(confirmation_email="u1@neura-test.fr", password="Password!2026")
        result = await server.delete_account_and_cloud_data(request, {"id": "u1"})
        return result, await db.users.count_documents({})
    result, users = run(scenario())
    assert cancelled == ["sub_1"] and result["account_deleted"] and users == 0

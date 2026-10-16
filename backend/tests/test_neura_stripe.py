"""Subscriptions with a simulated Stripe (no network, no key, no real payment): rights follow
Stripe's verified state only, webhooks must be signed, events are applied once."""
import asyncio
import hashlib
import hmac
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

SECRET = "whsec_test_neura"
FUTURE = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
PAST = int((datetime.now(timezone.utc) - timedelta(days=1)).timestamp())


class Recorder:
    def __init__(self, subscription=None):
        self.subscription = subscription or {}
        self.calls = []

    async def retrieve_async(self, subscription_id, params=None):
        self.calls.append(("retrieve", subscription_id))
        return {"id": subscription_id, **self.subscription}

    async def update_async(self, subscription_id, params):
        self.calls.append(("update", subscription_id, params))
        self.subscription["cancel_at_period_end"] = params.get("cancel_at_period_end")
        return {"id": subscription_id}

    async def create_async(self, params):
        self.calls.append(("create", params))
        return {"id": "cs_test_1", "url": "https://checkout.stripe.test/cs_test_1"}


class FakeStripe:
    def __init__(self, subscription=None):
        recorder = Recorder(subscription)
        self.recorder = recorder
        self.v1 = type("V1", (), {})()
        self.v1.subscriptions = recorder
        self.v1.checkout = type("C", (), {"sessions": recorder})()
        self.v1.billing_portal = type("P", (), {"sessions": recorder})()


def setup(monkeypatch, subscription=None, user=None):
    db = AsyncMongoMockClient()["stripe"]
    monkeypatch.setattr(server, "db", db)
    fake = FakeStripe(subscription)
    monkeypatch.setattr(server, "_stripe_client", lambda: fake)
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", SECRET)
    monkeypatch.setenv("PUBLIC_BACKEND_URL", "https://api.neura.test")
    monkeypatch.setenv("CORS_ORIGINS", "https://neura.test")
    base = {"id": "u1", "email": "u1@neura-test.fr", "subscription": "free", "stripe_subscription_id": None}
    asyncio.run(db.users.insert_one({**base, **(user or {})}))
    return db, fake


def subscription(status="active", invoice="paid", end=FUTURE, app="neura_alnour", plan="pro"):
    return {"status": status, "created": 100, "customer": "cus_1", "current_period_end": end,
            "cancel_at_period_end": False, "latest_invoice": {"status": invoice},
            "metadata": {"app": app, "user_id": "u1", "plan": plan}}


def user_after(db):
    return asyncio.run(db.users.find_one({"id": "u1"}, {"_id": 0}))


def test_paid_subscription_gives_the_plan(monkeypatch):
    db, _ = setup(monkeypatch, subscription())
    asyncio.run(server._sync_stripe_subscription("sub_1"))
    user = user_after(db)
    assert user["subscription"] == "pro" and user["subscription_status"] == "active"
    assert user["stripe_customer_id"] == "cus_1"


def test_unpaid_or_ended_subscription_gives_nothing(monkeypatch):
    for case in (subscription(invoice="open"), subscription(status="canceled"), subscription(end=PAST),
                 subscription(status="incomplete")):
        db, _ = setup(monkeypatch, case)
        asyncio.run(server._sync_stripe_subscription("sub_1"))
        assert user_after(db)["subscription"] == "free", case


def test_another_apps_subscription_is_ignored(monkeypatch):
    db, _ = setup(monkeypatch, subscription(app="other"))
    asyncio.run(server._sync_stripe_subscription("sub_1"))
    assert user_after(db)["subscription"] == "free" and "stripe_subscription_id" in user_after(db)


def signed(payload: dict, secret=SECRET):
    body = json.dumps(payload).encode()
    stamp = int(time.time())
    signature = hmac.new(secret.encode(), f"{stamp}.".encode() + body, hashlib.sha256).hexdigest()
    return body, {"Stripe-Signature": f"t={stamp},v1={signature}", "Content-Type": "application/json"}


def post_webhook(body, headers):
    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test") as c:
            return await c.post("/api/webhook/stripe", content=body, headers=headers)
    return asyncio.run(go())


def test_webhook_without_a_valid_signature_is_refused(monkeypatch):
    db, fake = setup(monkeypatch, subscription())
    event = {"id": "evt_1", "type": "customer.subscription.updated", "data": {"object": {"id": "sub_1"}}}
    body, headers = signed(event, secret="whsec_wrong")
    assert post_webhook(body, headers).status_code == 400
    assert post_webhook(json.dumps(event).encode(), {"Content-Type": "application/json"}).status_code == 400
    assert user_after(db)["subscription"] == "free" and not fake.recorder.calls


def test_signed_webhook_applies_the_plan_once(monkeypatch):
    db, fake = setup(monkeypatch, subscription())
    event = {"id": "evt_2", "object": "event", "type": "customer.subscription.updated",
             "data": {"object": {"id": "sub_1", "object": "subscription"}}}
    body, headers = signed(event)
    assert post_webhook(body, headers).status_code == 200
    assert post_webhook(body, headers).status_code == 200  # Stripe retries: applied once
    assert user_after(db)["subscription"] == "pro"
    assert [call for call in fake.recorder.calls if call[0] == "retrieve"] == [("retrieve", "sub_1")]


def test_checkout_only_returns_to_the_app_and_reuses_the_customer(monkeypatch):
    db, fake = setup(monkeypatch, user={"stripe_customer_id": "cus_9"})
    user = user_after(db)
    bad = server.SubscriptionRequest(plan="pro", billing_period="monthly", origin_url="https://evil.test")
    try:
        asyncio.run(server.create_checkout_session(bad, user))
        raised = False
    except server.HTTPException as exc:
        raised = exc.status_code == 400
    assert raised
    good = server.SubscriptionRequest(plan="pro", billing_period="monthly", origin_url="https://neura.test")
    result = asyncio.run(server.create_checkout_session(good, user))
    params = fake.recorder.calls[-1][1]
    assert result["url"].startswith("https://checkout.stripe.test")
    assert params["customer"] == "cus_9" and "customer_email" not in params
    assert params["line_items"][0]["price_data"]["unit_amount"] == int(server.SUBSCRIPTION_PLANS["pro"]["price_monthly"] * 100)
    assert user_after(db)["subscription"] == "free"  # nothing before Stripe confirms the payment


def test_portal_and_resume(monkeypatch):
    db, fake = setup(monkeypatch, subscription(), user={"stripe_customer_id": "cus_1", "stripe_subscription_id": "sub_1",
                                                         "subscription_cancel_at_period_end": True})
    user = user_after(db)
    portal = asyncio.run(server.billing_portal(server.BillingPortalRequest(origin_url="https://neura.test"), user))
    assert portal["url"] and fake.recorder.calls[-1][1]["customer"] == "cus_1"
    assert asyncio.run(server.resume_subscription(user))["cancel_at_period_end"] is False
    try:
        asyncio.run(server.billing_portal(server.BillingPortalRequest(origin_url="https://neura.test"),
                                          {"id": "u2", "email": "x@neura-test.fr"}))
        refused = False
    except server.HTTPException as exc:
        refused = exc.status_code == 404
    assert refused

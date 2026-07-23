import asyncio
import base64
import sys
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class UpdateResult:
    def __init__(self, modified_count=0, upserted_id=None):
        self.modified_count = modified_count
        self.upserted_id = upserted_id


def _value(doc, expression):
    if isinstance(expression, str) and expression.startswith("$"):
        return doc.get(expression[1:], 0)
    if isinstance(expression, dict) and "$add" in expression:
        return sum(_value(doc, part) for part in expression["$add"])
    return expression


def _matches(doc, query):
    for key, expected in query.items():
        if key == "$expr":
            operator, values = next(iter(expected.items()))
            left, right = (_value(doc, value) for value in values)
            if operator == "$lte" and not left <= right:
                return False
            if operator == "$lt" and not left < right:
                return False
            continue
        actual = doc.get(key)
        if isinstance(expected, dict):
            for operator, value in expected.items():
                if operator == "$ne":
                    if isinstance(actual, list) and value in actual:
                        return False
                    if not isinstance(actual, list) and actual == value:
                        return False
                elif operator == "$gt" and not actual > value:
                    return False
                elif operator == "$gte" and not actual >= value:
                    return False
                elif operator == "$lte" and not actual <= value:
                    return False
                else:
                    if operator not in ("$ne", "$gt", "$gte", "$lte"):
                        raise AssertionError(f"Unsupported query operator: {operator}")
        elif actual != expected:
            return False
    return True


class FakeCollection:
    def __init__(self):
        self.docs = {}

    async def find_one(self, query, projection=None, sort=None):
        matches = [doc for doc in self.docs.values() if _matches(doc, query)]
        if sort and matches:
            field, direction = sort[0]
            matches.sort(key=lambda item: item.get(field), reverse=direction < 0)
        return deepcopy(matches[0]) if matches else None

    async def insert_one(self, document):
        key = document.get("_id")
        if key in self.docs:
            raise DuplicateKeyError("duplicate")
        self.docs[key] = deepcopy(document)
        return object()

    async def update_one(self, query, update, upsert=False):
        existing_key = next((key for key, doc in self.docs.items() if _matches(doc, query)), None)
        inserted = False
        if existing_key is None:
            if not upsert:
                return UpdateResult()
            document = {
                key: deepcopy(value)
                for key, value in query.items()
                if not key.startswith("$") and not isinstance(value, dict)
            }
            document.update(deepcopy(update.get("$setOnInsert", {})))
            existing_key = document.get("_id") or document.get("id")
            self.docs[existing_key] = document
            inserted = True

        document = self.docs[existing_key]
        for key, value in update.get("$set", {}).items():
            document[key] = deepcopy(value)
        for key, value in update.get("$inc", {}).items():
            document[key] = document.get(key, 0) + value
        for key, value in update.get("$addToSet", {}).items():
            document.setdefault(key, [])
            if value not in document[key]:
                document[key].append(deepcopy(value))
        self.docs[existing_key] = document
        return UpdateResult(0 if inserted else 1, existing_key if inserted else None)

    async def update_many(self, query, update):
        count = 0
        for key, document in list(self.docs.items()):
            if not _matches(document, query):
                continue
            for field, value in update.get("$set", {}).items():
                document[field] = deepcopy(value)
            self.docs[key] = document
            count += 1
        return UpdateResult(count)


class FakeDB:
    def __init__(self):
        self.free_chat_quotas = FakeCollection()
        self.free_image_quotas = FakeCollection()
        self.free_image_captures = FakeCollection()
        self.mongo_image_generation_quotas = FakeCollection()
        self.messages = FakeCollection()
        self.chat_request_results = FakeCollection()
        self.conversations = FakeCollection()


@pytest.fixture
def quota_db(monkeypatch):
    fake = FakeDB()
    monkeypatch.setattr(server, "db", fake)
    monkeypatch.setattr(server, "FREE_TEXT_ADVANCED_BUDGET_UNITS", 10)
    monkeypatch.setattr(server, "FREE_TEXT_MEDIUM_BUDGET_UNITS", 6)
    monkeypatch.setattr(server, "FREE_IMAGE_MAX_UPLOADS", 3)
    monkeypatch.setattr(server, "FREE_IMAGE_ANALYSIS_BUDGET_UNITS", 10)
    monkeypatch.setattr(server, "MONGO_TEXT_ADVANCED_BUDGET_UNITS", 20)
    monkeypatch.setattr(server, "MONGO_TEXT_MEDIUM_BUDGET_UNITS", 10)
    monkeypatch.setattr(server, "MONGO_IMAGE_MAX_UPLOADS", 5)
    monkeypatch.setattr(server, "MONGO_IMAGE_ANALYSIS_BUDGET_UNITS", 20)
    monkeypatch.setattr(server, "MONGO_IMAGE_GENERATION_LIMIT", 3)
    return fake


def run(coro):
    return asyncio.run(coro)


def free_user():
    return {"id": "free-user", "email": "free@example.com", "subscription": "free", "is_vip": False}


def mongo_user():
    return {"id": "mongo-user", "email": "mongo@example.com", "subscription": "mongo", "is_vip": False}


def test_multi_provider_router_and_paid_behavior_are_preserved():
    free = free_user()
    standard_paid = {"id": "pro", "email": "pro@example.com", "subscription": "pro", "is_vip": False}
    neura_plus = {"id": "plus", "email": "plus@example.com", "subscription": "neura_plus", "is_vip": False}

    assert server._chat_profile_for_user(free, "chatgpt", "advanced")["provider"] == "openai"
    assert server._chat_profile_for_user(free, "chatgpt", "medium")["model_id"] == "gpt-4o-mini"
    assert server._chat_profile_for_user(free, "claude", "advanced")["provider"] == "anthropic"
    assert server._chat_profile_for_user(free, "claude", "medium")["model_id"] == "claude-haiku-4-5"
    assert server._chat_profile_for_user(free, "gemini", "medium")["model_id"] == "gemini-2.0-flash-lite"
    assert server._chat_profile_for_user(mongo_user(), "chatgpt", "advanced")["model_id"] == "gpt-4o"
    assert server._chat_profile_for_user(mongo_user(), "chatgpt", "medium")["model_id"] == "gpt-4o-mini"
    assert server._chat_profile_for_user(mongo_user(), "chatgpt", "economic")["model_id"] == "gpt-4.1-nano"
    assert server._chat_profile_for_user(mongo_user(), "claude", "advanced")["provider"] == "anthropic"
    assert server._chat_profile_for_user(mongo_user(), "claude", "economic")["model_id"] == "claude-3-5-haiku-20241022"
    assert server._chat_profile_for_user(mongo_user(), "gemini", "medium")["model_id"] == "gemini-2.0-flash-lite"
    assert server._chat_profile_for_user(mongo_user(), "gemini", "economic")["model_id"] == "gemini-2.0-flash-lite"
    assert server._chat_profile_for_user(mongo_user(), "grok", "advanced")["provider"] == "gemini"
    assert server._chat_profile_for_user(standard_paid, "claude", "advanced")["provider"] == "gemini"
    assert server._chat_profile_for_user(neura_plus, "claude", "advanced")["provider"] == "anthropic"


def test_model_metadata_comes_from_the_real_router_and_hides_grok():
    user = mongo_user()
    options = server._model_options_public(user)
    assert [option["key"] for option in options] == ["chatgpt", "claude", "gemini"]
    assert [option["model"]["label"] for option in options] == [
        "GPT-4o — IA avancée",
        "Claude Sonnet 4.5 — IA avancée",
        "Gemini 2.5 Flash — IA avancée",
    ]
    assert server._resolved_model_public(user, "chatgpt", "medium") == {
        "selection_key": "chatgpt",
        "provider": "openai",
        "model_id": "gpt-4o-mini",
        "display_name": "GPT-4o mini",
        "stage": "medium",
        "level_label": "IA moyenne",
        "label": "GPT-4o mini — IA moyenne",
    }
    assert server._resolved_model_public(user, "claude", "economic")["label"] == (
        "Claude 3.5 Haiku — IA économique"
    )
    assert server._resolved_model_public(user, "gemini", "medium")["label"] == (
        "Gemini 2.0 Flash Lite — IA moyenne"
    )
    legacy_grok = server._resolved_model_public(user, "grok", "advanced")
    assert legacy_grok["selection_key"] == "gemini"
    assert legacy_grok["provider"] == "gemini"
    assert legacy_grok["model_id"] == "gemini-2.5-flash"


def test_active_model_tracks_mongo_fallback_reset_and_legacy_history(quota_db):
    user = mongo_user()
    quota_db.conversations.docs["conversation"] = {
        "id": "conversation",
        "user_id": user["id"],
        "selected_model": "claude",
    }
    advanced = run(server._active_model_for_conversation(user, "conversation"))
    assert advanced["label"] == "Claude Sonnet 4.5 — IA avancée"

    run(server._reserve_text_quota(user, "conversation", 8))
    run(server._reserve_text_quota(user, "conversation", 8))
    assert run(server._reserve_text_quota(user, "conversation", 8))["stage"] == "medium"
    medium = run(server._active_model_for_conversation(user, "conversation"))
    assert medium["provider"] == "anthropic"
    assert medium["model_id"] == "claude-haiku-4-5"
    assert medium["label"] == "Claude Haiku 4.5 — IA moyenne"

    assert run(server._reserve_text_quota(user, "conversation", 8))["stage"] == "economic"
    economic = run(server._active_model_for_conversation(user, "conversation"))
    assert economic["model_id"] == "claude-3-5-haiku-20241022"
    assert economic["label"] == "Claude 3.5 Haiku — IA économique"

    quota_key = server._text_quota_key(user["id"], "conversation", "mongo")
    quota_db.free_chat_quotas.docs[quota_key]["reset_at"] = (
        datetime.now(timezone.utc) - timedelta(seconds=1)
    )
    renewed = run(server._active_model_for_conversation(user, "conversation"))
    assert renewed["label"] == "Claude Sonnet 4.5 — IA avancée"

    quota_db.conversations.docs["new-conversation"] = {
        "id": "new-conversation",
        "user_id": user["id"],
        "selected_model": "gemini",
    }
    new_conversation = run(
        server._active_model_for_conversation(user, "new-conversation")
    )
    assert new_conversation["label"] == "Gemini 2.5 Flash — IA avancée"

    quota_db.conversations.docs["legacy-grok"] = {
        "id": "legacy-grok",
        "user_id": user["id"],
        "selected_model": "grok",
    }
    legacy = run(server._active_model_for_conversation(user, "legacy-grok"))
    assert legacy["label"] == "Gemini 2.5 Flash — IA avancée"
    assert quota_db.conversations.docs["legacy-grok"]["selected_model"] == "grok"


def test_every_paid_plan_bypasses_the_free_quota(quota_db):
    for subscription in ("comme_toi", "pro", "developer", "neura_plus", "neura_ultra"):
        user = {"id": subscription, "email": f"{subscription}@example.com", "subscription": subscription, "is_vip": False}
        result = run(server._reserve_text_quota(user, "conversation", 999999))
        assert result["stage"] == "paid"
        assert result["quota"]["unlimited"] is True
    assert quota_db.free_chat_quotas.docs == {}


def test_mongo_text_quota_falls_back_without_blocking_and_renews(quota_db):
    user = mongo_user()
    assert run(server._reserve_text_quota(user, "mongo-a", 8))["stage"] == "advanced"
    assert run(server._reserve_text_quota(user, "mongo-a", 8))["stage"] == "advanced"

    medium = run(server._reserve_text_quota(user, "mongo-a", 8))
    assert medium["stage"] == "medium"
    assert [notice["quota_type"] for notice in medium["notices"]] == ["advanced_fallback"]

    economic = run(server._reserve_text_quota(user, "mongo-a", 8))
    assert economic["stage"] == "economic"
    assert economic["quota"]["blocked"] is False
    assert [notice["quota_type"] for notice in economic["notices"]] == ["economic_fallback"]

    for _ in range(5):
        continued = run(server._reserve_text_quota(user, "mongo-a", 100))
        assert continued["stage"] == "economic"
        assert continued["quota"]["blocked"] is False
        assert continued["notices"] == []

    independent = run(server._reserve_text_quota(user, "mongo-b", 5))
    assert independent["stage"] == "advanced"
    document = run(server._get_text_quota_doc(user["id"], "mongo-a", False, "mongo"))
    assert document["reset_at"] - document["period_started_at"] == timedelta(hours=server.MONGO_TEXT_WINDOW_HOURS)

    quota_db.free_chat_quotas.docs[server._text_quota_key(user["id"], "mongo-a", "mongo")]["reset_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    renewed = run(server._reserve_text_quota(user, "mongo-a", 2))
    assert renewed["stage"] == "advanced"
    assert renewed["quota"]["advanced_remaining"] == server.MONGO_TEXT_ADVANCED_BUDGET_UNITS - 2


def test_mongo_capture_limits_are_account_wide_and_analysis_is_independent(quota_db):
    user = mongo_user()
    payload = base64.b64encode(b"valid-image").decode()
    accepted = [
        run(server._accept_free_capture(user, f"conversation-{index}", f"capture-{index}", payload))
        for index in range(server.MONGO_IMAGE_MAX_UPLOADS)
    ]
    refused = run(server._accept_free_capture(user, "conversation-extra", "capture-extra", payload))
    assert all(result["accepted"] for result in accepted)
    assert accepted[-1]["image_quota"]["limit"] == server.MONGO_IMAGE_MAX_UPLOADS
    assert refused["accepted"] is False
    assert refused["image_quota"]["remaining"] == 0

    first_capture = accepted[0]["capture"]
    second_capture = accepted[1]["capture"]
    assert run(server._reserve_capture_analysis(user, "conversation-0", first_capture, 12))["allowed"]
    assert run(server._reserve_capture_analysis(user, "conversation-1", second_capture, 12))["allowed"]
    blocked = run(server._reserve_capture_analysis(user, "conversation-0", first_capture, 12))
    assert blocked["allowed"] is False
    assert blocked["capture"]["analysis_used"] == 12
    assert run(server._reserve_text_quota(user, "text-only", 5))["stage"] == "advanced"


def test_mongo_image_generation_quota_is_separate_and_releasable(quota_db):
    user = mongo_user()
    results = [run(server._reserve_mongo_generation(user["id"])) for _ in range(server.MONGO_IMAGE_GENERATION_LIMIT)]
    blocked = run(server._reserve_mongo_generation(user["id"]))
    assert all(result["allowed"] for result in results)
    assert blocked["allowed"] is False
    assert blocked["quota"]["remaining"] == 0
    assert blocked["quota"]["reset_at"] is not None

    run(server._release_mongo_generation(user["id"]))
    available = run(server._reserve_mongo_generation(user["id"]))
    assert available["allowed"] is True


def test_text_quota_is_independent_per_conversation_and_notices_are_unique(quota_db):
    user = free_user()
    first_a = run(server._reserve_text_quota(user, "conversation-a", 6))
    first_b = run(server._reserve_text_quota(user, "conversation-b", 6))
    assert first_a["stage"] == "advanced"
    assert first_b["stage"] == "advanced"

    fallback_a = run(server._reserve_text_quota(user, "conversation-a", 6))
    assert fallback_a["stage"] == "medium"
    assert len(fallback_a["notices"]) == 1
    assert fallback_a["notices"][0]["quota_type"] == "advanced_fallback"

    blocked_a = run(server._reserve_text_quota(user, "conversation-a", 1))
    assert blocked_a["stage"] == "blocked"
    assert len(blocked_a["notices"]) == 1
    assert blocked_a["notices"][0]["quota_type"] == "text_blocked"
    blocked_again = run(server._reserve_text_quota(user, "conversation-a", 1))
    assert blocked_again["stage"] == "blocked"
    assert blocked_again["notices"] == []

    untouched_b = run(server._get_text_quota_doc(user["id"], "conversation-b", False))
    assert untouched_b["stage"] == "advanced"
    assert untouched_b["advanced_used"] == 6
    assert len(quota_db.messages.docs) == 2


def test_text_quota_does_not_consume_during_inactivity_and_renews_per_conversation(quota_db):
    user = free_user()
    assert run(server._get_text_quota_doc(user["id"], "conversation-a", False)) is None
    run(server._reserve_text_quota(user, "conversation-a", 4))
    run(server._reserve_text_quota(user, "conversation-b", 3))
    before_a = run(server._get_text_quota_doc(user["id"], "conversation-a", False))
    unchanged_a = run(server._get_text_quota_doc(user["id"], "conversation-a", False))
    before_b = run(server._get_text_quota_doc(user["id"], "conversation-b", False))
    assert unchanged_a["advanced_used"] == before_a["advanced_used"] == 4
    assert before_a["conversation_id"] == "conversation-a"
    assert before_b["conversation_id"] == "conversation-b"
    assert before_a["reset_at"] - before_a["period_started_at"] == timedelta(hours=server.FREE_TEXT_WINDOW_HOURS)
    assert before_b["reset_at"] - before_b["period_started_at"] == timedelta(hours=server.FREE_TEXT_WINDOW_HOURS)

    key_a = server._text_quota_key(user["id"], "conversation-a")
    quota_db.free_chat_quotas.docs[key_a]["reset_at"] = datetime.now(timezone.utc) - timedelta(seconds=1)
    renewed = run(server._get_text_quota_doc(user["id"], "conversation-a", False))
    assert renewed["period_started_at"] is None
    assert renewed["advanced_used"] == 0
    assert renewed["medium_used"] == 0
    assert renewed["stage"] == "advanced"

    restarted = run(server._reserve_text_quota(user, "conversation-a", 2))
    still_b = run(server._get_text_quota_doc(user["id"], "conversation-b", False))
    assert restarted["stage"] == "advanced"
    assert still_b["advanced_used"] == 3


def test_parallel_text_reservations_cannot_exceed_a_stage_budget(quota_db):
    user = free_user()

    async def reserve_both():
        return await asyncio.gather(
            server._reserve_text_quota(user, "parallel", 6),
            server._reserve_text_quota(user, "parallel", 6),
        )

    results = run(reserve_both())
    document = run(server._get_text_quota_doc(user["id"], "parallel", False))
    assert {result["stage"] for result in results} == {"advanced", "medium"}
    assert document["advanced_used"] <= server.FREE_TEXT_ADVANCED_BUDGET_UNITS
    assert document["medium_used"] <= server.FREE_TEXT_MEDIUM_BUDGET_UNITS


def test_image_upload_limit_is_account_wide_and_idempotent(quota_db):
    user = free_user()
    payload = base64.b64encode(b"valid-image").decode()
    assert run(server._get_image_quota_doc(user["id"], False)) is None
    first = run(server._accept_free_capture(user, "conversation-a", "capture-1", payload))
    duplicate = run(server._accept_free_capture(user, "conversation-a", "capture-1", payload))
    second = run(server._accept_free_capture(user, "conversation-b", "capture-2", payload))
    third = run(server._accept_free_capture(user, "conversation-c", "capture-3", payload))
    refused = run(server._accept_free_capture(user, "conversation-new", "capture-4", payload))

    assert first["accepted"] and duplicate["duplicate"]
    assert second["accepted"] and third["accepted"]
    assert third["notice"]["quota_type"] == "image_upload_blocked"
    assert refused["accepted"] is False
    assert refused["notice"] is None
    assert refused["image_quota"]["used"] == 3
    assert refused["image_quota"]["remaining"] == 0
    assert len(quota_db.free_image_captures.docs) == 3
    assert len(quota_db.messages.docs) == 1


def test_parallel_image_uploads_cannot_exceed_the_account_limit(quota_db):
    user = free_user()
    payload = base64.b64encode(b"valid-image").decode()

    async def upload_all():
        return await asyncio.gather(*(
            server._accept_free_capture(user, f"conversation-{index}", f"capture-{index}", payload)
            for index in range(4)
        ))

    results = run(upload_all())
    assert sum(1 for result in results if result["accepted"]) == 3
    quota = run(server._get_image_quota_doc(user["id"], False))
    assert quota["uploads_used"] == 3


def test_each_capture_has_an_independent_analysis_budget_and_renews(quota_db):
    user = free_user()
    payload = base64.b64encode(b"valid-image").decode()
    capture_a = run(server._accept_free_capture(user, "conversation-a", "capture-a", payload))["capture"]
    capture_b = run(server._accept_free_capture(user, "conversation-b", "capture-b", payload))["capture"]

    allowed_a = run(server._reserve_capture_analysis(user, "conversation-a", capture_a, 6))
    allowed_b = run(server._reserve_capture_analysis(user, "conversation-b", capture_b, 6))
    blocked_a = run(server._reserve_capture_analysis(user, "conversation-a", capture_a, 6))
    blocked_a_again = run(server._reserve_capture_analysis(user, "conversation-a", capture_a, 6))
    assert allowed_a["allowed"] and allowed_b["allowed"]
    assert blocked_a["allowed"] is False and blocked_a["notice"] is not None
    assert blocked_a_again["notice"] is None

    stored_b = run(server._get_free_capture(user, "conversation-b", "capture-b"))
    assert stored_b["analysis_used"] == 6

    image_key = server._image_quota_key(user["id"])
    past = datetime.now(timezone.utc) - timedelta(seconds=1)
    quota_db.free_image_quotas.docs[image_key]["reset_at"] = past
    for document in quota_db.free_image_captures.docs.values():
        document["reset_at"] = past
    renewed = run(server._get_image_quota_doc(user["id"], False))
    assert renewed["uploads_used"] == 0
    assert all(document["analysis_used"] == 0 for document in quota_db.free_image_captures.docs.values())


def test_image_size_is_checked_on_the_server(quota_db, monkeypatch):
    monkeypatch.setattr(server, "FREE_IMAGE_MAX_BYTES", 3)
    with pytest.raises(HTTPException) as error:
        server._clean_image_payload(base64.b64encode(b"four").decode())
    assert error.value.status_code == 413


def test_request_idempotency_reuses_the_same_server_record(quota_db):
    first = run(server._begin_chat_request("user", "request-123", "conversation", "message"))
    second = run(server._begin_chat_request("user", "request-123", "conversation", "message"))
    assert first["new"] is True
    assert second["new"] is False
    assert first["record"]["_id"] == second["record"]["_id"]

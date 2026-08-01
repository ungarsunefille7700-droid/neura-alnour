import asyncio
import sys
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class FakeResult:
    def __init__(self, matched=0, modified=0):
        self.matched_count = matched
        self.modified_count = modified


class FakeCursor:
    def __init__(self, documents):
        self.documents = [deepcopy(item) for item in documents]

    def sort(self, field, direction):
        reverse = direction < 0
        self.documents.sort(key=lambda item: str(item.get(field, "")), reverse=reverse)
        return self

    async def to_list(self, limit):
        return self.documents[:limit]


class FakeCollection:
    def __init__(self):
        self.documents = []

    @staticmethod
    def _matches(document, query):
        for key, expected in query.items():
            if key in {"$or", "$expr"}:
                continue
            actual = document.get(key)
            if isinstance(expected, dict):
                if "$ne" in expected and actual == expected["$ne"]:
                    return False
                if "$exists" in expected and (key in document) != expected["$exists"]:
                    return False
            elif actual != expected:
                return False
        if "$or" in query:
            return any(FakeCollection._matches(document, choice) for choice in query["$or"])
        return True

    async def find_one(self, query, projection=None, **kwargs):
        for document in self.documents:
            if self._matches(document, query):
                result = deepcopy(document)
                if projection and projection.get("_id") == 0:
                    result.pop("_id", None)
                return result
        return None

    async def insert_one(self, document, **kwargs):
        self.documents.append(deepcopy(document))
        return FakeResult(modified=1)

    async def replace_one(self, query, document, **kwargs):
        for index, current in enumerate(self.documents):
            if self._matches(current, query):
                self.documents[index] = deepcopy(document)
                return FakeResult(matched=1, modified=1)
        return FakeResult()

    async def update_one(self, query, update, **kwargs):
        for document in self.documents:
            if self._matches(document, query):
                for key, value in update.get("$set", {}).items():
                    document[key] = deepcopy(value)
                return FakeResult(matched=1, modified=1)
        return FakeResult()

    async def count_documents(self, query):
        return sum(1 for item in self.documents if self._matches(item, query))

    def find(self, query, projection=None, **kwargs):
        matches = [item for item in self.documents if self._matches(item, query)]
        return FakeCursor(matches)


class FakeAdminDB:
    def __init__(self):
        self.neuraco_quota_config = FakeCollection()
        self.neuraco_pricing_history = FakeCollection()
        self.neuraco_incidents = FakeCollection()
        self.neuraco_promotions = FakeCollection()
        self.founder_admin_logs = FakeCollection()
        self.users = FakeCollection()


ADMIN = {
    "id": "admin-user-123",
    "email": "kaddanwalidpro@gmail.com",
    "is_vip": True,
    "subscription": "neura_ultra",
}


def test_runtime_policy_filters_disabled_providers_and_models():
    config = {
        "__providers__": {
            "anthropic": {"enabled": False},
            "openai": {"enabled": True},
            "gemini": {"enabled": True},
        },
        "gpt-4o": {"disabled": True},
    }
    assert server._neuraco_model_candidates("auto", config) == [
        ("gemini", "gemini-2.5-flash", "Gemini 2.5 Flash")
    ]


def test_maintenance_returns_controlled_error_without_credits_or_changes():
    with pytest.raises(HTTPException) as captured:
        server._require_neuraco_operational({
            "__maintenance__": {
                "enabled": True,
                "message": "Mise a jour en cours",
            }
        })
    assert captured.value.status_code == 503
    assert captured.value.detail["code"] == "neuraco_maintenance"
    assert captured.value.detail["credits_consumed"] is False
    assert captured.value.detail["changes_applied"] is False


def test_admin_config_update_is_versioned_and_rejects_stale_revision(monkeypatch):
    fake_db = FakeAdminDB()
    monkeypatch.setattr(server, "db", fake_db)
    request = server.NeuraCoAdminConfigUpdate(
        expected_revision=0,
        models={
            "gpt-4o": server.NeuraCoAdminModelConfig(
                provider="openai",
                input=3,
                cached_input=1.5,
                output=12,
                disabled=False,
            )
        },
        reason="Mise a jour du tarif fournisseur",
    )
    response = asyncio.run(server.founder_admin_update_neuraco_config(request, ADMIN))
    assert response["ok"] is True
    assert response["config"]["revision"] == 1
    assert response["config"]["models"]["gpt-4o"]["input"] == 3
    assert fake_db.neuraco_pricing_history.documents[0]["status"] == "committed"
    assert fake_db.neuraco_pricing_history.documents[0]["before"]["models"]["gpt-4o"]["input"] == 2.5
    assert fake_db.neuraco_pricing_history.documents[0]["after"]["models"]["gpt-4o"]["input"] == 3

    with pytest.raises(HTTPException) as captured:
        asyncio.run(server.founder_admin_update_neuraco_config(request, ADMIN))
    assert captured.value.status_code == 409


def test_admin_config_is_forbidden_to_regular_users(monkeypatch):
    monkeypatch.setattr(server, "db", FakeAdminDB())
    with pytest.raises(HTTPException) as captured:
        asyncio.run(server.founder_admin_neuraco_config({
            "id": "regular-user",
            "email": "regular@example.com",
            "is_vip": False,
        }))
    assert captured.value.status_code == 403

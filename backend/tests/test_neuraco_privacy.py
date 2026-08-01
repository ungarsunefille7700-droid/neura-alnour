import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class Result:
    def __init__(self, count=0):
        self.deleted_count = count
        self.modified_count = count


class Collection:
    def __init__(self, delete_count=0):
        self.delete_count = delete_count
        self.inserted = []
        self.deleted = []
        self.updated = []

    async def insert_one(self, document):
        self.inserted.append(dict(document))
        return Result(1)

    async def delete_many(self, query):
        self.deleted.append(query)
        return Result(self.delete_count)

    async def update_many(self, query, update):
        self.updated.append((query, update))
        return Result(1)


class Database:
    def __init__(self):
        self.collections = {}

    def __getitem__(self, name):
        return self.collections.setdefault(name, Collection())

    def __getattr__(self, name):
        return self[name]


def telemetry(**overrides):
    payload = {
        "event": "self_check_completed",
        "app_version": "1.2.3",
        "platform": "win32",
        "architecture": "x64",
        "success": True,
        "duration_bucket": "1_3s",
    }
    payload.update(overrides)
    return server.TechnicalTelemetryRequest(**payload)


def test_technical_telemetry_rejects_free_form_content():
    with pytest.raises(ValidationError):
        telemetry(source_code="print('private')")


def test_disabled_technical_telemetry_is_not_stored(monkeypatch):
    fake = Database()
    monkeypatch.setattr(server, "db", fake)
    result = asyncio.run(server.record_neuraco_technical_telemetry(
        telemetry(),
        {"id": "user-1", "privacy_settings": {"analytics_enabled": False}},
    ))
    assert result == {"ok": True, "recorded": False, "reason": "disabled"}
    assert fake.neuraco_technical_telemetry.inserted == []


def test_enabled_telemetry_stores_only_closed_technical_fields(monkeypatch):
    fake = Database()
    monkeypatch.setattr(server, "db", fake)
    result = asyncio.run(server.record_neuraco_technical_telemetry(
        telemetry(),
        {"id": "user-1", "email": "member@example.com"},
    ))
    assert result == {"ok": True, "recorded": True}
    document = fake.neuraco_technical_telemetry.inserted[0]
    assert set(document) == {
        "id", "user_id", "event", "app_version", "platform",
        "architecture", "success", "duration_bucket", "created_at",
    }
    assert "email" not in document
    assert "message" not in document


def test_cloud_deletion_clears_content_and_pseudonymizes_billing(monkeypatch):
    fake = Database()
    fake.collections["conversations"] = Collection(delete_count=3)
    monkeypatch.setattr(server, "db", fake)
    deleted = asyncio.run(server._delete_account_cloud_data("user-1"))

    assert deleted["conversations"] == 3
    assert fake.payment_transactions.deleted == []
    payment_update = fake.payment_transactions.updated[0][1]
    assert payment_update["$set"]["user_id"].startswith("deleted-")
    assert payment_update["$set"]["account_deleted"] is True
    assert "metadata" in payment_update["$unset"]
    assert fake.neuraco_credit_ledger.updated[0][1]["$set"]["user_id"].startswith("deleted-")


def test_account_deletion_pseudonym_is_stable_and_not_the_user_id():
    first = server._account_deletion_pseudonym("user-1")
    assert first == server._account_deletion_pseudonym("user-1")
    assert first != "user-1"
    assert first != server._account_deletion_pseudonym("user-2")


def test_account_deletion_rejects_wrong_confirmation_before_deleting(monkeypatch):
    fake = Database()

    async def find_one(*_args, **_kwargs):
        return {
            "id": "user-1",
            "email": "member@example.com",
            "password": "hash",
        }

    fake.users.find_one = find_one
    monkeypatch.setattr(server, "db", fake)
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.delete_account_and_cloud_data(
            server.AccountDeletionRequest(
                confirmation_email="wrong@example.com",
                password="not-used",
            ),
            {"id": "user-1"},
        ))
    assert error.value.status_code == 400
    assert fake.conversations.deleted == []

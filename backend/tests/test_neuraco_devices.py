import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class FakeCursor:
    def __init__(self, docs):
        self.docs = [dict(doc) for doc in docs]

    def sort(self, key, direction):
        self.docs.sort(key=lambda item: item.get(key, ""), reverse=direction < 0)
        return self

    async def to_list(self, limit):
        return self.docs[:limit]


class FakeDeviceCollection:
    def __init__(self, docs=None):
        self.docs = [dict(doc) for doc in (docs or [])]

    async def find_one(self, query):
        return next((
            dict(doc) for doc in self.docs
            if all(doc.get(key) == value for key, value in query.items())
        ), None)

    async def update_one(self, query, update, upsert=False):
        target = next((
            doc for doc in self.docs
            if all(doc.get(key) == value for key, value in query.items())
        ), None)
        if target is None and upsert:
            target = dict(query)
            target.update(update.get("$setOnInsert", {}))
            self.docs.append(target)
        if target is not None:
            target.update(update.get("$set", {}))
        return object()

    def find(self, query, projection=None):
        return FakeCursor([
            doc for doc in self.docs
            if all(doc.get(key) == value for key, value in query.items())
        ])

    async def find_one_and_update(self, query, update, return_document=None):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                doc.update(update.get("$set", {}))
                return dict(doc)
        return None


class FakeCommandCollection:
    def find(self, query, projection=None):
        return FakeCursor([])


class FakeDeviceDB:
    def __init__(self, docs=None):
        self.neuraco_relay_devices = FakeDeviceCollection(docs)
        self.neuraco_relay_commands = FakeCommandCollection()


def paid_user(user_id="user-1"):
    return {
        "id": user_id,
        "email": f"{user_id}@example.com",
        "subscription": "pro",
        "is_vip": False,
    }


def heartbeat(device_id="device_12345678"):
    return server.NeuraCoRelayHeartbeat(
        device_id=device_id,
        device_name="PC Windows",
        app_version="0.1.0",
        capabilities=["security", "remote_logout"],
    )


def test_heartbeat_registers_a_real_user_scoped_device(monkeypatch):
    fake_db = FakeDeviceDB()
    monkeypatch.setattr(server, "db", fake_db)
    response = asyncio.run(server.neuraco_relay_heartbeat(
        heartbeat(),
        paid_user(),
    ))
    assert response["revoked"] is False
    assert response["device"]["device_id"] == "device_12345678"
    assert fake_db.neuraco_relay_devices.docs[0]["user_id"] == "user-1"


def test_revocation_is_user_scoped_and_survives_future_heartbeats(monkeypatch):
    fake_db = FakeDeviceDB([{
        "user_id": "user-1",
        "device_id": "device_12345678",
        "device_name": "PC Windows",
        "app_version": "0.1.0",
        "last_seen_at": "2026-07-28T10:00:00+00:00",
    }])
    monkeypatch.setattr(server, "db", fake_db)

    revoked = asyncio.run(server.revoke_neuraco_relay_device(
        "device_12345678",
        paid_user(),
    ))
    assert revoked["online"] is False
    assert revoked["revoked_at"]

    response = asyncio.run(server.neuraco_relay_heartbeat(
        heartbeat(),
        paid_user(),
    ))
    assert response["revoked"] is True
    assert response["commands"] == []

    with pytest.raises(HTTPException) as missing:
        asyncio.run(server.revoke_neuraco_relay_device(
            "device_12345678",
            paid_user("other-user"),
        ))
    assert missing.value.status_code == 404


def test_device_list_never_returns_another_users_devices(monkeypatch):
    fake_db = FakeDeviceDB([
        {
            "user_id": "user-1",
            "device_id": "device_owner_123",
            "device_name": "Owner PC",
            "app_version": "0.1.0",
            "last_seen_at": "2026-07-28T10:00:00+00:00",
            "online_until": "2099-01-01T00:00:00+00:00",
        },
        {
            "user_id": "other-user",
            "device_id": "device_other_123",
            "device_name": "Other PC",
            "app_version": "0.1.0",
            "last_seen_at": "2026-07-28T10:00:00+00:00",
            "online_until": "2099-01-01T00:00:00+00:00",
        },
    ])
    monkeypatch.setattr(server, "db", fake_db)
    devices = asyncio.run(server.list_neuraco_relay_devices(paid_user()))
    assert [device["device_id"] for device in devices] == ["device_owner_123"]

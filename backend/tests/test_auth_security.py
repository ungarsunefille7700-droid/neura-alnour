import asyncio
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


class FakeResult:
    def __init__(self, modified_count=0):
        self.modified_count = modified_count


class FakeUsers:
    def __init__(self, user):
        self.user = dict(user)

    async def find_one(self, query, projection=None):
        return dict(self.user) if query.get("id") == self.user["id"] else None


class FakeSessions:
    def __init__(self):
        self.docs = []

    async def insert_one(self, document):
        self.docs.append(dict(document))
        return object()

    async def find_one(self, query, projection=None):
        for document in self.docs:
            if document.get("id") != query.get("id"):
                continue
            if document.get("user_id") != query.get("user_id"):
                continue
            if document.get("status") != query.get("status"):
                continue
            if document.get("expires_at") <= query["expires_at"]["$gt"]:
                continue
            return dict(document)
        return None

    async def update_one(self, query, update):
        for document in self.docs:
            if document.get("id") != query.get("id"):
                continue
            if query.get("user_id") and document.get("user_id") != query["user_id"]:
                continue
            if query.get("status") and document.get("status") != query["status"]:
                continue
            document.update(update["$set"])
            return FakeResult(1)
        return FakeResult()


class FakeAuthDB:
    def __init__(self, user):
        self.users = FakeUsers(user)
        self.auth_sessions = FakeSessions()


def test_session_bound_jwt_contains_session_and_unique_token_ids():
    token = server.create_token(
        "user-1",
        "member@example.com",
        session_id="session-1",
        token_id="token-1",
    )
    payload = jwt.decode(
        token,
        server.JWT_SECRET,
        algorithms=[server.JWT_ALGORITHM],
    )

    assert payload["user_id"] == "user-1"
    assert payload["sid"] == "session-1"
    assert payload["jti"] == "token-1"
    assert payload["iat"] < payload["exp"]


def test_legacy_jwt_remains_decodable_without_session_id():
    token = server.create_token("legacy-user", "legacy@example.com")
    payload = jwt.decode(
        token,
        server.JWT_SECRET,
        algorithms=[server.JWT_ALGORITHM],
    )

    assert payload["user_id"] == "legacy-user"
    assert "sid" not in payload
    assert "jti" not in payload


def test_totp_uses_rfc_6238_window_and_rejects_invalid_codes():
    secret = "JBSWY3DPEHPK3PXP"
    timestamp = 1_720_000_000
    code = server._totp_code(secret, timestamp)

    assert len(code) == 6
    assert server._verify_totp(secret, code, timestamp)
    assert server._verify_totp(secret, code, timestamp + 30)
    assert not server._verify_totp(secret, "00000X", timestamp)


def test_two_factor_secret_is_encrypted_at_rest():
    secret = "JBSWY3DPEHPK3PXP"
    encrypted = server._encrypt_auth_secret(secret)

    assert secret not in encrypted
    assert server._decrypt_auth_secret(encrypted) == secret


def test_public_session_never_exposes_jti_hash_or_full_client_ip():
    now = datetime.now(timezone.utc)
    public = server._public_auth_session(
        {
            "id": "session-1",
            "jti_hash": "private-hash",
            "device_name": "NeuraCo Desktop",
            "ip_hint": "203.0.113.x",
            "created_at": now,
            "last_seen_at": now,
            "expires_at": now + timedelta(days=7),
        },
        "session-1",
    )

    assert public["current"] is True
    assert public["ip_hint"] == "203.0.113.x"
    assert "jti_hash" not in public


def test_server_session_revocation_invalidates_the_bound_jwt(monkeypatch):
    user = {
        "id": "user-1",
        "email": "member@example.com",
        "name": "Member",
        "subscription": "pro",
        "is_vip": False,
    }
    fake_db = FakeAuthDB(user)
    monkeypatch.setattr(server, "db", fake_db)

    token = asyncio.run(server._issue_auth_token(user))
    authenticated = asyncio.run(server._user_from_bearer_token(token, None))
    assert authenticated["id"] == "user-1"
    session_id = jwt.decode(
        token,
        server.JWT_SECRET,
        algorithms=[server.JWT_ALGORITHM],
    )["sid"]
    fake_db.auth_sessions.docs[0]["status"] = "revoked"

    with pytest.raises(HTTPException) as revoked:
        asyncio.run(server._user_from_bearer_token(token, None))
    assert revoked.value.status_code == 401
    assert session_id == fake_db.auth_sessions.docs[0]["id"]


def test_optional_desktop_email_respects_opt_in_and_blocks_sensitive_content(
    monkeypatch,
):
    user = {
        "id": "user-1",
        "email": "member@example.com",
        "name": "Member",
        "subscription": "pro",
        "is_vip": False,
        "privacy_settings": {
            "desktop_notifications_email_enabled": False,
        },
    }
    fake_db = FakeAuthDB(user)
    monkeypatch.setattr(server, "db", fake_db)
    request = server.NeuraCoNotificationEmailRequest(
        kind="task_completed",
        severity="success",
        title="Tâche terminée",
        body="Le résultat est prêt.",
    )

    disabled = asyncio.run(server.send_neuraco_notification_email(request, user))
    assert disabled == {"ok": True, "sent": False, "reason": "disabled"}

    fake_db.users.user["privacy_settings"][
        "desktop_notifications_email_enabled"
    ] = True
    sensitive = asyncio.run(server.send_neuraco_notification_email(
        request.model_copy(update={"sensitive": True}),
        user,
    ))
    assert sensitive == {"ok": True, "sent": False, "reason": "sensitive"}


def test_optional_desktop_email_escapes_content_before_delivery(monkeypatch):
    user = {
        "id": "user-1",
        "email": "member@example.com",
        "name": "Member",
        "subscription": "pro",
        "is_vip": False,
        "privacy_settings": {
            "desktop_notifications_email_enabled": True,
        },
    }
    fake_db = FakeAuthDB(user)
    sent = []
    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server.resend, "api_key", "test-only")
    monkeypatch.setattr(
        server.resend.Emails,
        "send",
        lambda payload: sent.append(payload),
    )
    request = server.NeuraCoNotificationEmailRequest(
        kind="test_failed",
        severity="critical",
        title="<Test échoué>",
        body="<script>danger</script>",
    )

    result = asyncio.run(server.send_neuraco_notification_email(request, user))

    assert result == {"ok": True, "sent": True}
    assert sent[0]["to"] == ["member@example.com"]
    assert "<script>" not in sent[0]["html"]
    assert "&lt;script&gt;danger&lt;/script&gt;" in sent[0]["html"]

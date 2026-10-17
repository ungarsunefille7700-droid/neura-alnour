"""Project memory (step 2): kept per conversation with references to the real files and their
versions, given back to the AI, private to its owner, erased with the conversation."""
import asyncio
import json
import sys
from pathlib import Path

import pytest
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402
import neura_engine  # noqa: E402

ALICE = {"id": "alice", "email": "alice@neura-test.fr", "subscription": "free"}
BOB = {"id": "bob", "email": "bob@neura-test.fr", "subscription": "free"}
F = "`" * 3


def run(coro):
    return asyncio.run(coro)


@pytest.fixture()
def db(monkeypatch):
    database = AsyncMongoMockClient()["projects"]
    monkeypatch.setattr(server, "db", database)
    run(database.conversations.insert_one({"id": "c1", "user_id": "alice"}))
    return database


def snapshot(files, **extra):
    return server.ProjectSnapshot(conversation_id="c1", archive_name="neura_garage.zip", archive_size=2048,
                                  fingerprint="abc", total_files=7, files=[server.ProjectFileRef(**f) for f in files], **extra)


def test_files_studied_are_kept_with_their_version_and_changes_are_seen(db):
    first = run(server.save_project_snapshot(snapshot([{"path": "server/main.lua", "size": 10, "hash": "aaa", "state": "lu"},
                                                       {"path": "client/main.lua", "size": 9, "hash": "bbb", "state": "lu"}]), ALICE))
    assert first == {"ok": True, "files": 2, "changed_since_studied": []}
    again = run(server.save_project_snapshot(snapshot([{"path": "server/main.lua", "size": 12, "hash": "ccc", "state": "lu"}]), ALICE))
    assert again["changed_since_studied"] == ["server/main.lua"] and again["files"] == 2
    memory = run(server.get_project_memory("c1", ALICE))["memory"]
    assert memory["archive"]["name"] == "neura_garage.zip" and "user_id" not in memory


def test_a_project_memory_belongs_to_its_owner_only(db):
    run(server.save_project_snapshot(snapshot([{"path": "a.lua", "size": 1, "hash": "x", "state": "lu"}]), ALICE))
    assert run(server.get_project_memory("c1", BOB))["memory"] is None
    with pytest.raises(server.HTTPException) as refused:
        run(server.save_project_snapshot(snapshot([]), BOB))  # not his conversation
    assert refused.value.status_code == 404


def test_checks_become_open_errors_and_delivered_files_are_recorded(db, monkeypatch):
    run(server.save_project_snapshot(snapshot([{"path": "server/main.lua", "size": 10, "hash": "aaa", "state": "lu"}]), ALICE))
    run(server.save_project_checks(server.ProjectChecks(conversation_id="c1", issues=["client.lua : erreur Lua : ligne 3 : « if » jamais fermé"]), ALICE))

    class FakeChat:
        def __init__(self, **kwargs):
            pass

        def with_model(self, *args):
            return self

        def with_params(self, **kwargs):
            return self

        async def send_message(self, message):
            return json.dumps({"objectif": "Garage FiveM avec vérification du propriétaire",
                               "contraintes": ["Garder oxmysql et la table owned_vehicles"],
                               "decisions": ["Vérifier le propriétaire côté serveur"],
                               "etapes_restantes": ["Ajouter la NUI de sortie"]})

    monkeypatch.setattr(neura_engine, "LlmChat", FakeChat)
    answer = f"Voici :\n\nFichier: neura_garage/server/main.lua\n{F}lua\nprint(1)\nprint(2)\n{F}\n"
    run(server._update_project_memory(ALICE, "c1", "Ajoute la vérification du propriétaire", answer))
    memory = run(server.get_project_memory("c1", ALICE))["memory"]
    assert memory["open_errors"] == ["client.lua : erreur Lua : ligne 3 : « if » jamais fermé"]
    assert [(f["path"], f["lines"]) for f in memory["modified_files"]] == [("neura_garage/server/main.lua", 2)]
    assert memory["objective"].startswith("Garage FiveM") and memory["constraints"] == ["Garder oxmysql et la table owned_vehicles"]
    context = run(server._project_memory_context(ALICE, "c1"))
    for expected in ("MÉMOIRE DU PROJET", "Garder oxmysql", "Ajouter la NUI de sortie", "neura_garage/server/main.lua", "jamais fermé"):
        assert expected in context
    assert run(server._project_memory_context(BOB, "c1")) == ""


def test_the_first_message_with_an_archive_creates_the_memory_and_it_goes_with_the_conversation(db):
    run(server._ensure_project_memory(ALICE, "c1"))
    assert run(server.get_project_memory("c1", ALICE))["memory"] is not None
    run(db.messages.insert_one({"id": "m1", "conversation_id": "c1", "role": "user", "content": "x"}))
    run(server.delete_conversation("c1", ALICE))
    assert run(server.get_project_memory("c1", ALICE))["memory"] is None
    assert "project_memories" in server.ACCOUNT_CLOUD_DATA_COLLECTIONS  # exported and erased with the account


def test_no_project_no_extra_prompt_and_no_ai_call(db, monkeypatch):
    calls = []
    monkeypatch.setattr(neura_engine, "LlmChat", lambda **kwargs: calls.append(1))
    run(server._update_project_memory(ALICE, "c1", "salut", "Salut !"))
    assert calls == [] and run(server._project_memory_context(ALICE, "c1")) == ""

"""Long-term memory (remembered across conversations, with dates) and the French reading
of the model's English reasoning."""
import asyncio
import json
import sys
from pathlib import Path

import httpx
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402
import neura_engine  # noqa: E402
from neura_inference import CloudflareProvider  # noqa: E402

USER = {"id": "u1", "email": "u1@test.fr", "subscription": "free"}


def run(coro):
    return asyncio.run(coro)


def fresh_db(monkeypatch):
    db = AsyncMongoMockClient()["memory"]
    monkeypatch.setattr(server, "db", db)
    return db


def test_only_personal_messages_are_read_for_memory():
    assert server._auto_memory_candidate("Je m'appelle Walid et j'habite à Lyon.")
    assert server._auto_memory_candidate("Mon mariage est prévu le 4 août, je suis stressé.")
    assert not server._auto_memory_candidate("Quelle est la capitale du Maroc ?")
    assert not server._auto_memory_candidate("salut")
    assert server._auto_memory_candidate("Je prépare un serveur FiveM qui s'appelle Atlas RP")  # a project: kept
    assert not server._auto_memory_candidate("```js\nconst a = 1;\n```")


def test_model_answer_is_parsed_even_with_text_around_it():
    assert server._memory_json('Voici : {"ajouter": ["Habite à Lyon."], "modifier": []} merci') == {
        "ajouter": ["Habite à Lyon."], "modifier": []}
    assert server._memory_json("pas de json") == {}
    assert server._french_date("2026-08-04T10:00:00+00:00") == "4 août 2026"


def test_auto_memory_adds_updates_and_never_keeps_secrets(monkeypatch):
    db = fresh_db(monkeypatch)
    answers = []

    class FakeChat:
        def __init__(self, **kwargs):
            pass

        def with_model(self, *args):
            return self

        def with_params(self, **kwargs):
            return self

        async def send_message(self, message):
            answers.append(message.text)
            return json.dumps({
                "ajouter": ["Habite à Lyon.", "Son mot de passe est 1234.", "Habite à Lyon."],
                "modifier": [{"numero": 1, "texte": "S'appelle Walid Kaddan."}],
            })

    monkeypatch.setattr(neura_engine, "LlmChat", FakeChat)

    async def scenario():
        await db.ai_memories.insert_one({"id": "m1", "user_id": "u1", "label": "souvenir", "value": "S'appelle Walid.",
                                         "source": "auto", "created_at": "2026-08-04T10:00:00+00:00",
                                         "updated_at": "2026-08-04T10:00:00+00:00"})
        await server._auto_remember(USER, "Je m'appelle Walid Kaddan, j'habite à Lyon")
        return await db.ai_memories.find({"user_id": "u1"}, {"_id": 0}).to_list(10)

    rows = run(scenario())
    values = sorted(row["value"] for row in rows)
    assert values == ["Habite à Lyon.", "S'appelle Walid Kaddan."]  # updated, added once, secret dropped
    assert "1. S'appelle Walid." in answers[0]  # the model sees what it already knows


def test_memory_context_is_dated_and_brings_back_old_messages(monkeypatch):
    db = fresh_db(monkeypatch)

    async def scenario():
        await db.ai_memories.insert_one({"id": "m1", "user_id": "u1", "label": "souvenir",
                                         "value": "Son mariage est prévu le 4 décembre 2026.",
                                         "created_at": "2026-08-04T10:00:00+00:00", "updated_at": "2026-08-04T10:00:00+00:00"})
        await db.messages.insert_one({"user_id": "u1", "role": "user", "content": "J'ai peur pour le mariage de ma soeur",
                                      "created_at": "2026-08-04T09:00:00+00:00"})
        await db.messages.insert_one({"user_id": "other", "role": "user", "content": "mariage secret d'un autre",
                                      "created_at": "2026-08-04T09:00:00+00:00"})
        return await server._ai_memory_context(USER, "Tu te souviens de ce que je t'ai dit sur le mariage ?")

    context = run(scenario())
    assert "Son mariage est prévu le 4 décembre 2026. (dit le 4 août 2026)" in context
    assert "le 4 août 2026 : « J'ai peur pour le mariage de ma soeur »" in context
    assert "autre" not in context  # another user's messages are never read


def test_reasoning_is_translated_in_short_pieces():
    assert neura_engine.translation_pieces("One. Two!\nThree?") == ["One. Two!", "\n", "Three?"]
    long_text = " ".join(["This is a sentence."] * 40)
    assert all(len(piece) <= 300 for piece in neura_engine.translation_pieces(long_text))

    seen = []

    def handler(request):
        body = json.loads(request.content)
        seen.append(body["text"])
        return httpx.Response(200, json={"result": {"translated_text": f"FR({body['text']})",
                                                    "usage": {"neurons": 1.5}}})

    provider = CloudflareProvider("acc", "tok", "@cf/google/gemma-4-26b-a4b-it", transport=httpx.MockTransport(handler))
    runtime = neura_engine.configure(AsyncMongoMockClient()["translate"], provider, {}, from_env=False)
    try:
        text = run(runtime.translate("We need a script. Keep it short.\n```lua\n--\n```"))
    finally:
        neura_engine.configure(AsyncMongoMockClient()["translate"], None, {}, from_env=False)
    assert text.startswith("FR(We need a script. Keep it short.)")
    assert "--" in text and all("--" != piece for piece in seen)  # no letters: not sent

"""Image analysis on the free engine (step 4): off by default (Emergent keeps the images), and
when switched on: Gemma 4 receives the real image, the faithful-reading rule, the budget is
charged and logged, and Emergent stays the safety net if the engine fails."""
import asyncio
import json
import sys
from pathlib import Path

import httpx
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import neura_engine  # noqa: E402
from neura_engine import FileContent, LlmChat, UserMessage, _LegacyLlmChat  # noqa: E402
from neura_inference import CloudflareProvider  # noqa: E402

GEMMA = "@cf/google/gemma-4-26b-a4b-it"
OSS = "@cf/openai/gpt-oss-120b"
WEBP = "UklGRhYAAABXRUJQVlA4IAoAAAAwAQCdASoBAAEAAkA0JaQAA3AA/vuUAAA="
PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="


ALTERED = "قل هو الله أحد ۝ الله الواحد ۝ لم يلد ولم يولد ۝ ولم يكن له كفوا أحد"
EXACT = "قُلْ هُوَ اللَّهُ أَحَدٌ ۝ اللَّهُ الصَّمَدُ ۝ لَمْ يَلِدْ وَلَمْ يُولَدْ ۝ وَلَمْ يَكُن لَّهُ كُفُوًا أَحَدٌ"


class Fake:
    """The reading request (OCR) gets `read`; the answer request gets a fixed answer."""

    def __init__(self, status=200, read="AUCUN"):
        self.bodies = []
        self.status = status
        self.read = read

    def answers(self):
        return [b for b in self.bodies if not _is_reading(b)]

    def __call__(self, request):
        body = json.loads(request.content)
        self.bodies.append(body)
        if self.status != 200:
            return httpx.Response(self.status, json={"errors": ["indisponible"]})
        text = self.read if _is_reading(body) else "Il s'agit de la sourate Al-Ikhlas (112)."
        return httpx.Response(200, json={"choices": [{"message": {"content": text}}],
                                         "usage": {"prompt_tokens": 360, "completion_tokens": 20}})


def _is_reading(body):
    content = body["messages"][-1]["content"]
    return isinstance(content, list) and content[0]["text"].startswith("Recopie EXACTEMENT tout le texte arabe")


def engine(env, status=200, read="AUCUN"):
    fake = Fake(status, read)
    provider = CloudflareProvider("acc", "tok", GEMMA, transport=httpx.MockTransport(fake))
    db = AsyncMongoMockClient()["vision"]
    runtime = neura_engine.configure(db, provider, env, from_env=False)
    return fake, runtime, db


def teardown_function():
    neura_engine.configure(AsyncMongoMockClient()["vision"], None, {}, from_env=False)


def ask(image=WEBP, history=None, plan="free"):
    subject = neura_engine.current_ai_subject.set({"kind": "user", "id": "u1", "plan": plan})
    try:
        chat = LlmChat(api_key="k", session_id="neura_c1_vision", system_message="Tu es NEURA AL-NOUR.",
                       initial_messages=history)
        return asyncio.run(chat.send_message(UserMessage(text="De quelle sourate s'agit-il ?",
                                                         file_contents=[FileContent(content_type="image", file_content_base64=image)])))
    finally:
        neura_engine.current_ai_subject.reset(subject)


def test_off_by_default_images_stay_on_emergent(monkeypatch):
    fake, runtime, _db = engine({})
    called = []

    async def legacy(self, message):
        called.append(message.file_contents[0].file_content_base64)
        return "réponse Emergent"
    monkeypatch.setattr(_LegacyLlmChat, "send_message", legacy)
    assert runtime.status()["vision"] == "legacy"
    assert ask() == "réponse Emergent"
    assert called == [WEBP] and fake.bodies == []


def test_on_gemma_receives_the_real_image_and_the_reading_rule():
    fake, runtime, db = engine({"NEURA_VISION_PROVIDER": "engine"})
    assert runtime.status()["vision"] == GEMMA
    history = [{"role": "system", "content": "Tu es NEURA AL-NOUR."}, {"role": "user", "content": "Salam"}, {"role": "assistant", "content": "Wa alaykum salam"}]
    assert ask(PNG, history) == "Il s'agit de la sourate Al-Ikhlas (112)."
    assert len(fake.bodies) == 2 and _is_reading(fake.bodies[0])  # the reading first, then the answer
    body = fake.answers()[0]
    assert body["model"] == GEMMA and body["max_tokens"] >= 1536
    assert "LECTURE D'IMAGE" in body["messages"][0]["content"] and "Tu es NEURA AL-NOUR." in body["messages"][0]["content"]
    assert [m["content"] for m in body["messages"][1:3]] == ["Salam", "Wa alaykum salam"]
    last = body["messages"][-1]["content"]
    assert last[0] == {"type": "text", "text": "De quelle sourate s'agit-il ?"}
    assert last[1]["image_url"]["url"] == f"data:image/png;base64,{PNG}"
    assert "VÉRIFICATION AUTOMATIQUE" not in body["messages"][0]["content"]  # no Arabic text read: no note
    assert asyncio.run(db.ai_usage_log.find_one({"source": "vision_ocr"}))["status"] == "ok"
    log = asyncio.run(db.ai_usage_log.find_one({"source": "vision"}))
    assert log["status"] == "ok" and log["model"] == GEMMA and log["neurons"] > 0 and log["subject_id"] == "u1"


def test_webp_and_data_url_prefix():
    fake, _runtime, _db = engine({"NEURA_VISION_PROVIDER": "engine"})
    ask("data:image/webp;base64," + WEBP)
    for body in fake.bodies:
        assert body["messages"][-1]["content"][1]["image_url"]["url"] == f"data:image/webp;base64,{WEBP}"


def test_engine_failure_falls_back_to_emergent(monkeypatch):
    fake, _runtime, db = engine({"NEURA_VISION_PROVIDER": "engine"}, status=503)

    async def legacy(self, message):
        return "réponse Emergent de secours"
    monkeypatch.setattr(_LegacyLlmChat, "send_message", legacy)
    assert ask() == "réponse Emergent de secours"
    assert len(fake.answers()) == 1
    assert asyncio.run(db.ai_usage_log.find_one({"source": "vision"}))["status"] == "error"


def test_text_messages_are_unchanged_when_vision_is_on():
    fake, _runtime, _db = engine({"NEURA_VISION_PROVIDER": "engine"})
    subject = neura_engine.current_ai_subject.set({"kind": "user", "id": "u1", "plan": "free"})
    try:
        chat = LlmChat(api_key="k", session_id="neura_c1", system_message="Tu es Neura.")
        asyncio.run(chat.send_message(UserMessage(text="Salam, ça va ?")))
    finally:
        neura_engine.current_ai_subject.reset(subject)
    body = fake.bodies[0]
    assert isinstance(body["messages"][-1]["content"], str) and "LECTURE D'IMAGE" not in body["messages"][0]["content"]


def test_an_altered_verse_is_checked_against_the_quran_before_the_answer():
    fake, _runtime, _db = engine({"NEURA_VISION_PROVIDER": "engine"}, read=ALTERED)
    ask()
    system = fake.answers()[0]["messages"][0]["content"]
    assert "VÉRIFICATION AUTOMATIQUE DU TEXTE CORANIQUE" in system
    assert "sourate 112 Al-Ikhlaas" in system and "versets 1 à 4" in system
    assert "N'EST PAS EXACT" in system
    assert "verset 2 : l'image a « الواحد », le texte authentique a « الصمد »" in system


def test_an_exact_verse_is_confirmed_but_not_its_vowels():
    fake, _runtime, _db = engine({"NEURA_VISION_PROVIDER": "engine"}, read=EXACT)
    ask()
    system = fake.answers()[0]["messages"][0]["content"]
    assert "les mots sont IDENTIQUES au texte authentique" in system and "ne garantis pas le tashkeel" in system


def test_the_reading_failing_never_blocks_the_answer():
    class ReadingFails(Fake):
        def __call__(self, request):
            body = json.loads(request.content)
            if _is_reading(body):
                self.bodies.append(body)
                return httpx.Response(500, json={"errors": ["panne"]})
            return super().__call__(request)
    fake = ReadingFails()
    provider = CloudflareProvider("acc", "tok", GEMMA, transport=httpx.MockTransport(fake))
    db = AsyncMongoMockClient()["vision"]
    neura_engine.configure(db, provider, {"NEURA_VISION_PROVIDER": "engine"}, from_env=False)
    assert ask() == "Il s'agit de la sourate Al-Ikhlas (112)."
    assert asyncio.run(db.ai_usage_log.find_one({"source": "vision_ocr"}))["status"] == "error"

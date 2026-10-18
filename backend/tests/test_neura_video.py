"""Video analysis (step 5): on with a 10 % reserve and a daily limit per person (0 % = off);
speech pieces keep their place in the video; frames are described with the faithful-reading rule; everything is charged to the video
reserve, never to the user's own budget; the timeline reaches the AI within the ceilings."""
import asyncio
import base64
import json
import struct
import sys
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException
from mongomock_motor import AsyncMongoMockClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402
import neura_engine  # noqa: E402
from neura_inference import CloudflareProvider  # noqa: E402

GEMMA = "@cf/google/gemma-4-26b-a4b-it"
USER = {"id": "u1", "email": "u1@neura-test.fr", "subscription": "free"}


def wav(seconds: float) -> bytes:
    data = b"\x00\x00" * int(16000 * seconds)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 16000, 32000, 2, 16) \
        + b"data" + struct.pack("<I", len(data)) + data


class Fake:
    def __init__(self):
        self.calls = []

    def __call__(self, request):
        url = str(request.url)
        body = json.loads(request.content)
        self.calls.append((url, body))
        if "whisper" in url:
            return httpx.Response(200, json={"result": {
                "segments": [{"start": 0.7, "end": 4.9, "text": " Le premier pilier est la chahada."},
                             {"start": 6.0, "end": 8.0, "text": "  "}],
                "usage": {"neurons": 23.3}, "transcription_info": {"duration": 30}}})
        return httpx.Response(200, json={"choices": [{"message": {"content": "00:10 | titre bleu | texte : Leçon\n00:20 | titre vert | texte : aucun"}}],
                                         "usage": {"prompt_tokens": 500, "completion_tokens": 40}})


def engine(env):
    fake = Fake()
    db = AsyncMongoMockClient()["video"]
    runtime = neura_engine.configure(db, CloudflareProvider("acc", "tok", GEMMA, transport=httpx.MockTransport(fake)), env, from_env=False)
    return fake, runtime, db


def teardown_function():
    neura_engine.configure(AsyncMongoMockClient()["video"], None, {}, from_env=False)


def call(coro):
    subject = neura_engine.current_ai_subject.set({"kind": "user", "id": "u1", "plan": "free"})
    try:
        return asyncio.run(coro)
    finally:
        neura_engine.current_ai_subject.reset(subject)


def speech(offset=60.0, seconds=30):
    return server.VideoSpeechRequest(audio_base64=base64.b64encode(wav(seconds)).decode(), offset=offset, language="fr")


def test_on_by_default_with_10_percent_and_off_with_0():
    assert engine({})[1].video_share == 0.1
    fake, runtime, _db = engine({"NEURA_AI_VIDEO_SHARE": "0"})
    assert not runtime.video_enabled
    with pytest.raises(HTTPException) as info:
        call(server.video_speech(speech(), USER))
    assert info.value.status_code == 503 and "pas encore activée" in info.value.detail
    assert call(server.video_status(USER))["enabled"] is False
    assert fake.calls == []


def test_speech_keeps_its_place_in_the_video_and_uses_the_video_reserve():
    fake, runtime, db = engine({"NEURA_AI_VIDEO_SHARE": "0.2"})
    out = call(server.video_speech(speech(offset=60.0), USER))
    assert out["segments"] == [{"start": 60.7, "end": 64.9, "text": "Le premier pilier est la chahada."}]
    assert out["neurons"] == 23.3  # the real cost told by Cloudflare
    url, body = fake.calls[0]
    assert url.endswith("/run/@cf/openai/whisper-large-v3-turbo") and body["language"] == "fr"
    pool = asyncio.run(db.ai_budget_subjects.find_one({"_id": {"$regex": "^pool:videos:"}}))
    assert pool["committed"] == 23.3
    assert asyncio.run(db.ai_budget_subjects.find_one({"_id": {"$regex": "^user:u1:"}})) is None
    status = call(server.video_status(USER))
    # the person's own limit (free: 100 Neurons a day, about 2 min of spoken video) is the tighter one
    assert status == {"enabled": True, "neurons_left_today": round(100 - 23.3, 1),
                      "minutes_left_today": round((100 - 23.3) / 50, 1), "unlimited": False}
    mine = asyncio.run(db.ai_budget_subjects.find_one({"_id": {"$regex": "^video_user:u1:"}}))
    assert mine["committed"] == 23.3


def test_frames_are_described_with_the_faithful_reading_rule():
    fake, _runtime, db = engine({"NEURA_AI_VIDEO_SHARE": "0.2"})
    out = call(server.video_frames(server.VideoFramesRequest(image_base64="UklGRgAAAABXRUJQ", timestamps=[10, 20]), USER))
    assert out["text"].startswith("00:10 | titre bleu")
    _url, body = fake.calls[0]
    assert "LECTURE D'IMAGE" in body["messages"][0]["content"]
    assert "(00:10, 00:20)" in body["messages"][1]["content"][0]["text"]
    assert body["messages"][1]["content"][1]["image_url"]["url"] == "data:image/webp;base64,UklGRgAAAABXRUJQ"
    assert asyncio.run(db.ai_usage_log.find_one({"source": "video_frames"}))["subject_id"] == "u1"


def test_a_used_up_reserve_gives_a_clear_message():
    engine({"NEURA_AI_VIDEO_SHARE": "0.0001"})  # under one Neuron
    with pytest.raises(HTTPException) as info:
        call(server.video_speech(speech(), USER))
    assert info.value.status_code == 429 and info.value.detail.startswith("L'analyse vidéo gratuite est terminée pour aujourd'hui")


def test_wrong_audio_is_refused():
    engine({"NEURA_AI_VIDEO_SHARE": "0.2"})
    bad = server.VideoSpeechRequest(audio_base64=base64.b64encode(b"pas un wav").decode())
    with pytest.raises(HTTPException) as info:
        call(server.video_speech(bad, USER))
    assert info.value.status_code == 400
    with pytest.raises(Exception, match="at most 1400000 characters"):  # 40 s: refused before anything runs
        server.VideoSpeechRequest(audio_base64=base64.b64encode(wav(40)).decode())
    just_over = server.VideoSpeechRequest(audio_base64=base64.b64encode(wav(31.5)).decode())
    with pytest.raises(HTTPException) as info:
        call(server.video_speech(just_over, USER))
    assert info.value.status_code == 400


def test_the_timeline_reaches_the_ai_within_the_ceiling():
    token = neura_engine.current_ai_extra_input.set(0)
    try:
        text = server._video_context("[00:10] IMAGE titre\n" + "x" * 100000, "instant")
        assert text.startswith(server.VIDEO_GUARD) and len(text) == len(server.VIDEO_GUARD) + 6000 * 3.5
        assert neura_engine.current_ai_extra_input.get() == 6000
        server._video_context("[00:10] PAROLE salam", "high")  # added to the workshop's room, if any
        assert neura_engine.current_ai_extra_input.get() == 6000 + 24000
        assert server._video_context("", "high") == ""
    finally:
        neura_engine.current_ai_extra_input.reset(token)


def test_each_person_has_a_daily_video_limit_by_subscription():
    fake, runtime, db = engine({})
    for _ in range(4):  # 4 x 23.3 Neurons = 93.2: still under the free 100
        call(server.video_speech(speech(), USER))
    with pytest.raises(HTTPException) as info:  # a 5th piece would go over (its worst case is reserved first)
        call(server.video_speech(speech(), USER))
    assert info.value.status_code == 429 and info.value.detail.startswith("Tu as utilisé ta limite d'analyse vidéo pour aujourd'hui")
    whisper_calls = [c for c in fake.calls if "whisper" in c[0]]
    assert len(whisper_calls) == 4  # the refused piece never reached Cloudflare (never charged)
    mine = asyncio.run(db.ai_budget_subjects.find_one({"_id": {"$regex": "^video_user:u1:"}}))
    pool = asyncio.run(db.ai_budget_subjects.find_one({"_id": {"$regex": "^pool:videos:"}}))
    assert round(mine["committed"], 3) == round(pool["committed"], 3) == 93.2  # the refusal was given back
    # another person still has their own allowance; an Ultra subscriber has 1,000 a day
    other = {"id": "u2", "email": "u2@neura-test.fr", "subscription": "neura_ultra"}
    assert call(server.video_speech(speech(), other))["segments"]
    assert server._video_user_limit(other) == 1000
    assert server._video_user_limit({"id": "v", "email": "v@neura-test.fr", "subscription": "free", "is_vip": True}) is None

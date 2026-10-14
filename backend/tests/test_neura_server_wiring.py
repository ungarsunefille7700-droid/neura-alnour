"""server.py keeps working with the Neura engine plugged in."""
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


def engine(env):
    provider = CloudflareProvider("acc", "tok", "@cf/google/gemma-4-26b-a4b-it",
                                  transport=httpx.MockTransport(lambda request: httpx.Response(500)))
    return neura_engine.configure(AsyncMongoMockClient()["wiring"], provider, env, from_env=False)


def teardown_function():
    neura_engine.configure(AsyncMongoMockClient()["wiring"], None, {}, from_env=False)


def test_budget_subject_follows_the_plan():
    assert server._ai_subject({"id": "a", "subscription": "free"}) == {"kind": "user", "id": "a", "plan": "free"}
    assert server._ai_subject({"id": "b", "subscription": "neura_plus"})["plan"] == "paid"
    assert server._ai_subject({"id": "c", "subscription": "free", "is_vip": True})["plan"] == "vip"


def test_gateway_routes_are_mounted_and_llmchat_goes_through_the_engine():
    paths = set(server.app.openapi()["paths"])
    assert {"/v1/chat/completions", "/v1/models", "/api/gateway/keys", "/api/gateway/stats"} <= paths
    from neura_engine import LlmChat
    import emergentintegrations.llm.chat as legacy
    assert issubclass(LlmChat, legacy.LlmChat) and LlmChat is not legacy.LlmChat


def test_strict_free_mode_blocks_paid_legacy_features():
    engine({"NEURA_LEGACY_AI": "off"})
    with pytest.raises(HTTPException) as info:
        server._require_legacy_ai("La génération d'images")
    assert info.value.status_code == 503 and "mode IA gratuit" in info.value.detail


def test_legacy_features_stay_available_by_default():
    engine({})
    server._require_legacy_ai("La génération d'images")  # no exception: behaviour unchanged
    neura_engine.configure(AsyncMongoMockClient()["wiring"], None, {}, from_env=False)
    server._require_legacy_ai("La génération d'images")


def test_engine_refusals_reach_the_user_verbatim():
    refusal = neura_engine.EngineRefused("Le quota gratuit d'IA est épuisé pour aujourd'hui.", "quota")
    assert server.user_facing_ai_error(refusal) == "Le quota gratuit d'IA est épuisé pour aujourd'hui."
    assert server.user_facing_ai_error(RuntimeError("boom")) is None

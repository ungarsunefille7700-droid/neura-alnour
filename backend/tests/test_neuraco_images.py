import asyncio
import base64
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


PNG_BYTES = b"\x89PNG\r\n\x1a\nneuraco-test"
PNG_BASE64 = base64.b64encode(PNG_BYTES).decode("ascii")


class FakeImageAudit:
    def __init__(self):
        self.docs = []

    async def insert_one(self, document):
        self.docs.append(dict(document))
        return object()


class FakeImageDb:
    def __init__(self):
        self.neuraco_image_audit = FakeImageAudit()


def paid_user():
    return {
        "id": "image-user-1",
        "email": "image-user@example.com",
        "subscription": "pro",
        "is_vip": False,
    }


def source_image():
    return server.NeuraCoAgentImageContext(
        id="source-image-123",
        name="source.png",
        mime_type="image/png",
        data_base64=PNG_BASE64,
        width=64,
        height=64,
        size=len(PNG_BYTES),
    )


def completion():
    return {
        "images": [{
            "mime_type": "image/png",
            "data_base64": PNG_BASE64,
        }],
        "provider": "OpenRouter",
        "model": "google/gemini-2.5-flash-image",
        "model_display": "Gemini 2.5 Flash Image",
        "usage": {
            "input_tokens": 120,
            "output_tokens": 40,
            "total_tokens": 160,
            "cost_usd": 0.04,
        },
        "rights": {
            "status": "not_reported",
            "message": "Conditions non transmises.",
        },
    }


def test_image_prompt_is_operation_specific_and_numbers_variants():
    prompt = server._image_studio_prompt(
        "remove_background",
        "",
        variant_index=1,
        variant_count=3,
    )
    assert "arrière-plan" in prompt
    assert "Variante 2 sur 3" in prompt
    assert "fond transparent" in prompt


def test_provider_completion_uses_multimodal_source_and_reports_real_metadata(
    monkeypatch,
):
    requests = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "model": "google/gemini-2.5-flash-image",
                "choices": [{
                    "message": {
                        "images": [{
                            "image_url": {
                                "url": f"data:image/png;base64,{PNG_BASE64}",
                            },
                        }],
                    },
                }],
                "usage": {
                    "prompt_tokens": 33,
                    "completion_tokens": 7,
                    "total_tokens": 40,
                    "cost": 0.025,
                },
            }

    class FakeClient:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, url, headers, json):
            requests.append({"url": url, "headers": headers, "json": json})
            return FakeResponse()

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeClient)
    result = asyncio.run(
        server._openrouter_image_completion(
            "Modifie cette image.",
            {
                "mime_type": "image/png",
                "data_base64": PNG_BASE64,
            },
        )
    )

    content = requests[0]["json"]["messages"][0]["content"]
    assert requests[0]["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert content[0]["type"] == "text"
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert result["images"][0]["data_base64"] == PNG_BASE64
    assert result["model"] == "google/gemini-2.5-flash-image"
    assert result["usage"]["cost_usd"] == 0.025
    assert result["rights"]["status"] == "not_reported"


def test_provider_completion_rejects_missing_image_without_live_retry(monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"choices": [{"message": {"images": []}}]}

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, *_args, **_kwargs):
            return FakeResponse()

    monkeypatch.setattr(server.httpx, "AsyncClient", FakeClient)
    with pytest.raises(HTTPException) as error:
        asyncio.run(server._openrouter_image_completion("test"))
    assert error.value.status_code == 502


def test_neuraco_image_endpoint_generates_variants_and_preserves_original(
    monkeypatch,
):
    fake_db = FakeImageDb()
    reservations = []
    settlements = []

    async def reserve(
        _user,
        reservation_id,
        estimated_credits,
        task_id,
        project_id,
        agent,
        provider,
        model,
    ):
        reservations.append({
            "reservation_id": reservation_id,
            "estimated_credits": estimated_credits,
            "task_id": task_id,
            "project_id": project_id,
            "agent": agent,
            "provider": provider,
            "model": model,
        })
        return {"status": "reserved"}

    async def settle(reservation_id, metering, duration_ms):
        settlements.append({
            "reservation_id": reservation_id,
            "metering": metering,
            "duration_ms": duration_ms,
        })
        return {"credits_consumed": 1.25}

    async def provider(*_args, **_kwargs):
        return completion()

    monkeypatch.setattr(server, "db", fake_db)
    monkeypatch.setattr(server, "_reserve_neuraco_usage", reserve)
    monkeypatch.setattr(server, "_settle_neuraco_usage", settle)
    monkeypatch.setattr(server, "_openrouter_image_completion", provider)

    request = server.NeuraCoImageStudioRequest(
        request_id="request-image-123",
        project_id="project-image-123",
        operation="edit",
        prompt="Ajoute une lumière douce.",
        variants=2,
        source=source_image(),
    )
    result = asyncio.run(server.generate_neuraco_images(request, paid_user()))

    assert len(result["outputs"]) == 2
    assert result["original_preserved"] is True
    assert result["provider"] == "OpenRouter"
    assert result["model"] == "google/gemini-2.5-flash-image"
    assert result["usage"]["credits_consumed"] == 2.5
    assert len(reservations) == 2
    assert len(settlements) == 2
    assert fake_db.neuraco_image_audit.docs[0]["generated_variants"] == 2
    assert "data_base64" not in fake_db.neuraco_image_audit.docs[0]


def test_neuraco_image_endpoint_requires_source_for_edit():
    request = server.NeuraCoImageStudioRequest(
        request_id="request-image-456",
        project_id="project-image-456",
        operation="edit",
        prompt="Modifie l'image.",
    )
    with pytest.raises(HTTPException) as error:
        asyncio.run(server.generate_neuraco_images(request, paid_user()))
    assert error.value.status_code == 400


def test_image_metering_uses_provider_cost_and_safe_fallback():
    reported = server._neuraco_image_metering(completion())
    fallback = server._neuraco_image_metering({
        **completion(),
        "usage": {
            "input_tokens": None,
            "output_tokens": None,
            "cost_usd": None,
        },
    })
    assert reported["provider_cost_usd"] == 0.04
    assert reported["metering"] == "provider_reported"
    assert reported["credits"] > 0
    assert fallback["credits"] == 5.0
    assert fallback["metering"] == "estimated_fallback"

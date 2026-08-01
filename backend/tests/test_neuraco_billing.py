import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


PRICING = {
    "gpt-4o": {
        "provider": "openai",
        "input": 2.0,
        "cached_input": 0.5,
        "output": 8.0,
    },
    "__version__": "pricing-test-v3",
    "__billing__": {
        "credits_per_usd": 20,
        "margin_percent": 10,
        "infrastructure_per_request_usd": 0.01,
        "compute_per_second_usd": 0.001,
        "storage_per_mb_usd": 0.002,
        "browser_call_usd": 0.003,
        "computer_call_usd": 0.004,
        "additional_agent_usd": 0.005,
        "remote_task_usd": 0.006,
        "priority_multipliers": {
            "standard": 1,
            "high": 1.2,
        },
    },
    "__tools__": {
        "terminal": 0.25,
    },
}


def test_server_pricing_registry_accounts_for_all_supported_cost_factors():
    basic = server._neuraco_usage_cost(
        "gpt-4o",
        input_tokens=10_000,
        cached_input_tokens=2_000,
        output_tokens=2_000,
        pricing_overrides=PRICING,
    )
    expanded = server._neuraco_usage_cost(
        "gpt-4o",
        input_tokens=10_000,
        cached_input_tokens=2_000,
        output_tokens=2_000,
        pricing_overrides=PRICING,
        cost_factors={
            "duration_seconds": 10,
            "storage_mb": 5,
            "browser_calls": 2,
            "computer_calls": 1,
            "agents": 3,
            "remote_tasks": 1,
            "priority": "high",
            "tool_calls": {"terminal": 2},
        },
    )

    assert expanded["credits"] > basic["credits"]
    assert expanded["credit_breakdown"]["tools"] == 0.5
    assert expanded["credit_breakdown"]["infrastructure"] > 0
    assert expanded["pricing_version"] == "pricing-test-v3"
    assert expanded["rounding_rule"] == "half_up_0.01_credit"


def test_cached_tokens_are_charged_at_the_configured_lower_rate():
    uncached = server._neuraco_usage_cost(
        "gpt-4o",
        input_tokens=100_000,
        cached_input_tokens=0,
        output_tokens=1,
        pricing_overrides=PRICING,
    )
    cached = server._neuraco_usage_cost(
        "gpt-4o",
        input_tokens=100_000,
        cached_input_tokens=100_000,
        output_tokens=1,
        pricing_overrides=PRICING,
    )
    assert cached["credits"] < uncached["credits"]


def test_public_ledger_hides_internal_provider_contract_costs():
    public = server._neuraco_public_ledger_entry({
        "type": "consumption",
        "status": "settled",
        "provider": "openai",
        "model": "gpt-4o",
        "provider_cost_usd": 1.25,
        "internal_cost_usd": 2.5,
        "credit_breakdown": {"ai": 1.0, "infrastructure": 0.2, "tools": 0.0},
        "pricing_version": "v1",
        "credits_consumed": 1.2,
        "created_at": "2026-07-29T12:00:00+00:00",
        "commercial_secret": "never expose this",
    })

    assert public["credit_breakdown"]["infrastructure"] == 0.2
    assert public["pricing_version"] == "v1"
    assert "provider_cost_usd" not in public
    assert "internal_cost_usd" not in public
    assert "commercial_secret" not in public


def test_usage_settings_validate_agent_and_model_caps():
    request = server.NeuraCoUsageSettingsRequest(
        agent_cap=50,
        max_agents=4,
        max_model="gpt-4o",
    )
    assert request.agent_cap == 50
    assert request.max_agents == 4
    assert request.max_model == "gpt-4o"

    with pytest.raises(ValidationError):
        server.NeuraCoUsageSettingsRequest(max_agents=17)
    with pytest.raises(ValidationError):
        server.NeuraCoUsageSettingsRequest(max_model="invented-model")

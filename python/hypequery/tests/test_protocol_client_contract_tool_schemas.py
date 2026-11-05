"""MCP query-tool schemas agree with TypeScript on the shared descriptors."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.protocol import (
    ProtocolClientContractError,
    build_client_contract_tool_schemas,
)

DIRECTORY = (
    Path(__file__).resolve().parents[3] / "specs/security-protocol/fixtures/client-contract-v1"
)
SUCCESS = cast(list[dict[str, object]], json.loads((DIRECTORY / "success.json").read_text()))
EXPECTED = cast(
    dict[str, dict[str, object]], json.loads((DIRECTORY / "tool-schemas.json").read_text())
)


@pytest.mark.parametrize("case", SUCCESS, ids=lambda case: cast(str, case["id"]))
def test_tool_schemas_match_the_typescript_fixture(case: dict[str, object]) -> None:
    schemas = build_client_contract_tool_schemas(case["value"])
    actual = {
        "manifestHash": schemas["manifest_hash"],
        "query_dataset": schemas["query_dataset"],
        "query_metric": schemas["query_metric"],
    }
    # Key order too: clients that hash or diff the advertised schema see the same bytes.
    assert json.dumps(actual) == json.dumps(EXPECTED[cast(str, case["id"])])


def test_every_success_descriptor_is_pinned() -> None:
    assert set(EXPECTED) == {case["id"] for case in SUCCESS}


def test_the_manifest_hash_is_the_contract_content_hash() -> None:
    contract = next(case["value"] for case in SUCCESS if case["id"] == "build")
    schemas = build_client_contract_tool_schemas(contract)
    assert schemas["manifest_hash"] == schemas["contract"]["contentHash"]


def test_empty_views_keep_uncallable_tools() -> None:
    contract = next(case["value"] for case in SUCCESS if case["id"] == "empty")
    schemas = build_client_contract_tool_schemas(contract)
    assert schemas["query_dataset"] == {
        "type": "object",
        "properties": {"dataset": {"not": {}}},
        "required": ["dataset"],
        "additionalProperties": False,
    }
    assert schemas["query_metric"]["required"] == ["dataset", "metric"]


def test_mcp_limits_advertise_the_endpoint_ceiling() -> None:
    contract = cast(dict[str, object], next(c["value"] for c in SUCCESS if c["id"] == "build"))
    endpoint = next(
        e for e in cast(list[dict[str, object]], contract["endpoints"]) if e["id"] == "orders"
    )
    maximum = cast(dict[str, int], endpoint["limits"])["maxLimit"]
    schema = build_client_contract_tool_schemas(contract)["query_dataset"]
    variants = cast(list[dict[str, dict[str, object]]], schema["anyOf"])
    orders = next(
        v for v in variants if v["properties"]["dataset"] == {"type": "string", "const": "orders"}
    )
    assert orders["properties"]["limit"] == {"type": "integer", "minimum": 1, "maximum": maximum}
    # MCP names the grain `grain`; the HTTP body calls it `by`.
    assert "grain" in orders["properties"]
    assert "by" not in orders["properties"]


def test_an_unsigned_contract_is_refused() -> None:
    contract = dict(cast(dict[str, object], SUCCESS[0]["value"]))
    del contract["contentHash"]
    with pytest.raises(ProtocolClientContractError):
        build_client_contract_tool_schemas(contract)

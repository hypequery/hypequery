# ruff: noqa: E501 -- the expected hints are kept verbatim to compare with TypeScript.
"""Hints on a rejected client query match the TypeScript bridge's, string for string."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from hypequery.mcp.utils.query_hints import client_query_field_hint, client_query_target_hint
from hypequery.protocol import validate_protocol_client_contract

_SUCCESS: list[dict[str, Any]] = json.loads(
    (
        Path(__file__).parents[3]
        / "specs/security-protocol/fixtures/client-contract-v1/success.json"
    ).read_text("utf-8")
)
CONTRACT = validate_protocol_client_contract(
    next(c["value"] for c in _SUCCESS if c["id"] == "build")
)

# Kept identical to packages/mcp-server/src/utils/http-client/query-hint.test.ts.
EXPECTED = [
    ("target", "query_dataset", ' Datasets: "countries", "orders".'),
    ("target", "query_metric", ' Metrics: "ordersRevenue" on "orders".'),
    ("orders", "/dimensions/0", ' Offered by "orders": "amount", "country", "customer.tier".'),
    (
        "orders",
        "/measures/2",
        ' Offered by "orders": "averageRevenue", "customer.unique", "latestLabel", "orderCount", "revenue".',
    ),
    (
        "orders",
        "/filters/0/field",
        ' Offered by "orders": "amount", "country", "customer.active", "customer.tier", "paidStatus".',
    ),
    (
        "orders",
        "/orderBy/0/field",
        ' Offered by "orders": "amount", "country", "customer.tier", "averageRevenue", "customer.unique", "latestLabel", "orderCount", "revenue".',
    ),
    (
        "orders",
        "/having/0/field",
        ' Offered by "orders": "averageRevenue", "customer.unique", "latestLabel", "orderCount", "revenue".',
    ),
    ("orders", "/filters/0/value", ""),
    ("countries", "/measures/0", ' "countries" offers none.'),
]


@pytest.mark.parametrize(("target", "argument", "hint"), EXPECTED)
def test_the_hint_matches_typescript(target: str, argument: str, hint: str) -> None:
    if target == "target":
        assert client_query_target_hint(CONTRACT, argument) == hint
    else:
        endpoint = next(e for e in CONTRACT["endpoints"] if e["id"] == target)
        assert client_query_field_hint(endpoint, argument) == hint

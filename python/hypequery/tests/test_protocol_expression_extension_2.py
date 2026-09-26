"""RFC 0015 expression extension 2 (``expressions-v2``)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from hypequery.protocol import (
    ProtocolDatasetQuery,
    ProtocolExpressionError,
    semantic_query_to_data,
    validate_protocol_expression,
    validate_protocol_semantic_query,
)
from hypequery.protocol.expression_fixtures import materialize_expression_fixture

FIXTURES = Path(__file__).resolve().parents[3] / "specs" / "security-protocol" / "fixtures"


def _load(family: str, name: str) -> object:
    return json.loads((FIXTURES / family / name).read_text(encoding="utf-8"))


def _input(case: dict[str, object]) -> object:
    generator = case.get("generator")
    if type(generator) is dict:
        return materialize_expression_fixture(cast(dict[str, object], generator))
    return case["value"]


V1_SUCCESS = cast(dict[str, list[dict[str, object]]], _load("expressions-v1", "success.json"))
V2_SUCCESS = cast(dict[str, list[dict[str, object]]], _load("expressions-v2", "success.json"))
V2_REJECTIONS = cast(list[dict[str, object]], _load("expressions-v2", "rejections.json"))


def test_every_extension_1_success_case_is_unchanged_under_extension_2() -> None:
    for case in V1_SUCCESS["queries"]:
        value = case["value"]
        assert validate_protocol_semantic_query(value, extension=2) == (
            validate_protocol_semantic_query(value)
        ), case["id"]


@pytest.mark.parametrize("case", V2_SUCCESS["queries"], ids=lambda case: str(case["id"]))
def test_extension_2_queries_round_trip(case: dict[str, object]) -> None:
    query = validate_protocol_semantic_query(case["value"], extension=2)
    assert semantic_query_to_data(query) == case["value"]


@pytest.mark.parametrize("case", V2_REJECTIONS, ids=lambda case: str(case["id"]))
def test_extension_2_rejections(case: dict[str, object]) -> None:
    validate = (
        validate_protocol_semantic_query
        if case["mode"] == "query"
        else validate_protocol_expression
    )
    with pytest.raises(ProtocolExpressionError) as raised:
        validate(_input(case), extension=2)
    assert raised.value.code == case["error"]


def test_extension_2_additions_stay_out_of_extension_1() -> None:
    cases = [
        (
            validate_protocol_expression,
            {"kind": "aggregate", "aggregation": "approxCountDistinct", "field": "user_id"},
            "HQ_EXPRESSION_INVALID_AGGREGATION",
        ),
        (
            validate_protocol_semantic_query,
            {"kind": "dataset", "dataset": "e", "by": "minute"},
            "HQ_EXPRESSION_INVALID_QUERY",
        ),
        (
            validate_protocol_semantic_query,
            {"kind": "dataset", "dataset": "o", "segments": []},
            "HQ_EXPRESSION_UNKNOWN_FIELD",
        ),
        (
            validate_protocol_semantic_query,
            {"kind": "dataset", "dataset": "o", "measures": ["customer.customerCount"]},
            "HQ_EXPRESSION_INVALID_IDENTIFIER",
        ),
    ]
    for validate, value, code in cases:
        with pytest.raises(ProtocolExpressionError) as raised:
            validate(value)
        assert raised.value.code == code


def test_segments_keep_authored_order() -> None:
    query = validate_protocol_semantic_query(
        {"kind": "dataset", "dataset": "o", "segments": ["b", "a"]}, extension=2
    )
    assert isinstance(query, ProtocolDatasetQuery)
    assert query.segments == ("b", "a")


def test_unsupported_extension_is_rejected() -> None:
    with pytest.raises(ValueError, match="extension"):
        validate_protocol_expression({"kind": "reference", "name": "x"}, extension=3)  # type: ignore[arg-type]

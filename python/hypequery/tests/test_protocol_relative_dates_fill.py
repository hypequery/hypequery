"""RFC 0029 ``inDateRange``, ``fill`` and ``timeKey`` on portable semantic queries."""

from __future__ import annotations

import pytest

from hypequery.protocol import (
    ProtocolCachePreimageError,
    ProtocolDatasetQuery,
    ProtocolExpressionError,
    build_protocol_cache_preimage,
    is_protocol_relative_date_range,
    parse_protocol_relative_date_range,
    semantic_query_to_data,
    validate_protocol_expression,
    validate_protocol_semantic_query,
)

SECRET = bytes(32)
DEFINITION = "a" * 64


def _range(value: object) -> dict[str, object]:
    return {
        "kind": "comparison",
        "operator": "inDateRange",
        "left": {"kind": "reference", "name": "created_at"},
        "right": {"kind": "literal", "value": value},
    }


def _query(**fields: object) -> dict[str, object]:
    return {"kind": "dataset", "dataset": "orders", "measures": ["revenue"], **fields}


def _code(value: object) -> str:
    with pytest.raises(ProtocolExpressionError) as raised:
        validate_protocol_semantic_query(value)
    return raised.value.code


@pytest.mark.parametrize(
    ("value", "kind", "unit", "count"),
    [
        ("today", "today", None, None),
        ("yesterday", "yesterday", None, None),
        ("this quarter", "this", "quarter", None),
        ("last week", "last", "week", 1),
        ("last 30 days", "last", "day", 30),
        ("last 1 month", "last", "month", 1),
        ("last 3 month", "last", "month", 3),
        ("year to date", "toDate", "year", None),
    ],
)
def test_parses_the_grammar(value: str, kind: str, unit: str | None, count: int | None) -> None:
    parsed = parse_protocol_relative_date_range(value)
    assert parsed is not None
    assert (parsed.kind, parsed.unit, parsed.count) == (kind, unit, count)


@pytest.mark.parametrize(
    "value",
    [
        "last 0 days",
        "Last 7 days",
        "last 07 days",
        "last 10000 days",
        "week to date",
        "today\n",
        7,
        None,
    ],
)
def test_refuses_values_outside_the_grammar(value: object) -> None:
    assert not is_protocol_relative_date_range(value)
    assert _code(_query(filters=[_range(value)])) == "HQ_EXPRESSION_INVALID_VALUE"


def test_accepts_in_date_range_anywhere_in_query_filters() -> None:
    nested = {"kind": "logical", "operator": "not", "operand": _range("last 7 days")}
    query = validate_protocol_semantic_query(_query(filters=[_range("today"), nested]))
    assert semantic_query_to_data(query)["filters"] == [_range("today"), nested]


def test_refuses_in_date_range_outside_query_filters() -> None:
    with pytest.raises(ProtocolExpressionError) as raised:
        validate_protocol_expression(_range("today"))
    assert raised.value.code == "HQ_EXPRESSION_INVALID_OPERATOR"
    aggregate = {
        "kind": "comparison",
        "operator": "gt",
        "left": {
            "kind": "aggregate",
            "aggregation": "sum",
            "field": "amount",
            "filters": [_range("today")],
        },
        "right": {"kind": "literal", "value": 1},
    }
    assert _code(_query(filters=[aggregate])) == "HQ_EXPRESSION_INVALID_OPERATOR"


def test_fill_round_trips_and_needs_by() -> None:
    query = validate_protocol_semantic_query(
        _query(by="day", fill=True, filters=[_range("last 30 days")])
    )
    assert isinstance(query, ProtocolDatasetQuery)
    assert query.fill is True
    assert semantic_query_to_data(query)["fill"] is True
    assert _code(_query(fill=True)) == "HQ_EXPRESSION_INVALID_QUERY"
    assert _code(_query(by="day", fill="true")) == "HQ_EXPRESSION_TYPE"
    metric = {"kind": "metric", "dataset": "orders", "metric": "revenue", "by": "day", "fill": True}
    assert _code(metric) == "HQ_EXPRESSION_UNKNOWN_FIELD"


def _preimage(query: dict[str, object]) -> str:
    return build_protocol_cache_preimage(
        secret=SECRET,
        definition_identity=DEFINITION,
        query=query,
        tenant={"mode": "none"},
        row_limit=None,
    )


def test_preimage_refuses_relative_ranges_and_fill_but_drops_fill_false() -> None:
    for query in (_query(filters=[_range("today")]), _query(by="day", fill=True)):
        with pytest.raises(ProtocolCachePreimageError) as raised:
            _preimage(query)
        assert raised.value.code == "HQ_CACHE_PREIMAGE_INVALID_QUERY"
    assert _preimage(_query(by="day", fill=False)) == _preimage(_query(by="day"))


def test_time_key_round_trips_on_dataset_and_metric_queries() -> None:
    dataset = validate_protocol_semantic_query(_query(by="week", timeKey="shipped_at"))
    assert dataset.time_key == "shipped_at"
    assert semantic_query_to_data(dataset)["timeKey"] == "shipped_at"
    metric = validate_protocol_semantic_query(
        {"kind": "metric", "dataset": "orders", "metric": "revenue", "timeKey": "shipped_at"}
    )
    assert metric.time_key == "shipped_at"
    assert _code(_query(timeKey="customer.shipped_at")) == "HQ_EXPRESSION_INVALID_IDENTIFIER"


def test_preimage_refuses_a_time_key() -> None:
    with pytest.raises(ProtocolCachePreimageError) as raised:
        _preimage(_query(by="day", timeKey="shipped_at"))
    assert raised.value.code == "HQ_CACHE_PREIMAGE_INVALID_QUERY"

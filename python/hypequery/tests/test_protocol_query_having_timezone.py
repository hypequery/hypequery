"""RFC 0025 ``having`` and ``timezone`` on portable semantic queries."""

from __future__ import annotations

import math

import pytest

from hypequery.protocol import (
    ProtocolCachePreimageError,
    ProtocolDatasetQuery,
    ProtocolExpressionError,
    ProtocolHavingCondition,
    ProtocolMetricQuery,
    build_protocol_cache_preimage,
    semantic_query_to_data,
    validate_protocol_semantic_query,
)

SECRET = bytes(32)
DEFINITION = "a" * 64


def _query(**fields: object) -> dict[str, object]:
    return {"kind": "dataset", "dataset": "orders", "measures": ["revenue"], **fields}


def _code(value: object, extension: int = 1) -> str:
    with pytest.raises(ProtocolExpressionError) as raised:
        validate_protocol_semantic_query(value, extension=extension)  # type: ignore[arg-type]
    return raised.value.code


@pytest.mark.parametrize("extension", [1, 2])
def test_having_round_trips_every_operator(extension: int) -> None:
    having = [
        {"measure": "revenue", "operator": "gt", "value": 1000},
        {"measure": "revenue", "operator": "lte", "value": -1.5},
        {"measure": "revenue", "operator": "between", "value": [1, 5]},
        {"measure": "revenue", "operator": "in", "value": [0]},
        {"measure": "revenue", "operator": "notIn", "value": [0, 2.5]},
    ]
    source = _query(having=having)
    query = validate_protocol_semantic_query(source, extension=extension)  # type: ignore[arg-type]
    assert isinstance(query, ProtocolDatasetQuery)
    assert query.having is not None
    condition = query.having[2]
    assert isinstance(condition, ProtocolHavingCondition)
    assert (condition.measure, condition.operator, condition.value) == (
        "revenue",
        "between",
        (1, 5),
    )
    assert semantic_query_to_data(query) == source


def test_empty_having_is_kept() -> None:
    source = {"kind": "dataset", "dataset": "orders", "having": []}
    assert semantic_query_to_data(validate_protocol_semantic_query(source)) == source


def test_having_relationship_measure_needs_extension_2() -> None:
    source = {
        "kind": "dataset",
        "dataset": "orders",
        "measures": ["customer.customerCount"],
        "having": [{"measure": "customer.customerCount", "operator": "gte", "value": 10}],
    }
    query = validate_protocol_semantic_query(source, extension=2)
    assert semantic_query_to_data(query) == source
    assert _code(source) == "HQ_EXPRESSION_INVALID_IDENTIFIER"


@pytest.mark.parametrize(
    ("condition", "code"),
    [
        ({"measure": "orders", "operator": "gt", "value": 1}, "HQ_EXPRESSION_INVALID_QUERY"),
        ({"measure": "revenue", "operator": "like", "value": 1}, "HQ_EXPRESSION_INVALID_QUERY"),
        ({"measure": "revenue", "operator": "isNull", "value": 1}, "HQ_EXPRESSION_INVALID_QUERY"),
        ({"measure": "revenue", "operator": "gt", "value": "1"}, "HQ_EXPRESSION_INVALID_QUERY"),
        ({"measure": "revenue", "operator": "gt", "value": None}, "HQ_EXPRESSION_INVALID_QUERY"),
        (
            {"measure": "revenue", "operator": "gt", "value": math.inf},
            "HQ_EXPRESSION_INVALID_QUERY",
        ),
        (
            {"measure": "revenue", "operator": "gt", "value": math.nan},
            "HQ_EXPRESSION_INVALID_QUERY",
        ),
        ({"measure": "revenue", "operator": "gt", "value": 10**400}, "HQ_EXPRESSION_INVALID_QUERY"),
        ({"measure": "revenue", "operator": "gt", "value": [1]}, "HQ_EXPRESSION_INVALID_QUERY"),
        (
            {"measure": "revenue", "operator": "between", "value": [1]},
            "HQ_EXPRESSION_INVALID_QUERY",
        ),
        (
            {"measure": "revenue", "operator": "between", "value": [1, 2, 3]},
            "HQ_EXPRESSION_INVALID_QUERY",
        ),
        ({"measure": "revenue", "operator": "in", "value": []}, "HQ_EXPRESSION_INVALID_QUERY"),
        (
            {"measure": "revenue", "operator": "in", "value": [1, "2"]},
            "HQ_EXPRESSION_INVALID_QUERY",
        ),
        ({"measure": "revenue", "operator": "in", "value": 1}, "HQ_EXPRESSION_TYPE"),
        ({"measure": "revenue", "operator": 1, "value": 1}, "HQ_EXPRESSION_TYPE"),
        ({"measure": "revenue", "operator": "gt"}, "HQ_EXPRESSION_TYPE"),
        (
            {"measure": "revenue", "operator": "gt", "value": 1, "field": "x"},
            "HQ_EXPRESSION_UNKNOWN_FIELD",
        ),
        ({"measure": "rev enue", "operator": "gt", "value": 1}, "HQ_EXPRESSION_INVALID_IDENTIFIER"),
    ],
)
def test_having_refusals(condition: dict[str, object], code: str) -> None:
    assert _code(_query(having=[condition])) == code
    assert _code(_query(having=[condition]), extension=2) == code


@pytest.mark.parametrize("operator", ["eq", "between", "in"])
@pytest.mark.parametrize("flag", [True, False])
def test_booleans_are_not_having_numbers(operator: str, flag: bool) -> None:
    value: object = flag if operator == "eq" else [flag, 1] if operator == "between" else [flag]
    condition = {"measure": "revenue", "operator": operator, "value": value}
    assert _code(_query(having=[condition])) == "HQ_EXPRESSION_INVALID_QUERY"


def test_having_needs_selected_measures() -> None:
    source = {
        "kind": "dataset",
        "dataset": "orders",
        "having": [{"measure": "revenue", "operator": "gt", "value": 1}],
    }
    assert _code(source) == "HQ_EXPRESSION_INVALID_QUERY"


def test_having_must_be_an_array_within_limits() -> None:
    assert _code(_query(having={"measure": "revenue"})) == "HQ_EXPRESSION_TYPE"
    many = [{"measure": "revenue", "operator": "gt", "value": 1}] * 101
    assert _code(_query(having=many)) == "HQ_EXPRESSION_TOO_MANY_ITEMS"


@pytest.mark.parametrize("extension", [1, 2])
def test_metric_queries_refuse_having(extension: int) -> None:
    source = {"kind": "metric", "dataset": "orders", "metric": "revenue", "having": []}
    assert _code(source, extension) == "HQ_EXPRESSION_UNKNOWN_FIELD"


@pytest.mark.parametrize("extension", [1, 2])
@pytest.mark.parametrize("kind", ["dataset", "metric"])
def test_timezone_round_trips_with_or_without_grain(extension: int, kind: str) -> None:
    base: dict[str, object] = {"kind": kind, "dataset": "orders"}
    if kind == "metric":
        base["metric"] = "revenue"
    for source in ({**base, "timezone": "Europe/London"}, {**base, "by": "day", "timezone": "UTC"}):
        query = validate_protocol_semantic_query(source, extension=extension)  # type: ignore[arg-type]
        assert isinstance(query, ProtocolDatasetQuery | ProtocolMetricQuery)
        assert query.timezone == source["timezone"]
        assert semantic_query_to_data(query) == source


@pytest.mark.parametrize(
    ("timezone", "code"),
    [
        ("Mars/Olympus_Mons", "HQ_EXPRESSION_INVALID_QUERY"),
        ("europe/london", "HQ_EXPRESSION_INVALID_QUERY"),
        ("utc", "HQ_EXPRESSION_INVALID_QUERY"),
        ("", "HQ_EXPRESSION_INVALID_QUERY"),
        (0, "HQ_EXPRESSION_TYPE"),
        (None, "HQ_EXPRESSION_TYPE"),
        (True, "HQ_EXPRESSION_TYPE"),
    ],
)
def test_timezone_must_be_a_registry_name(timezone: object, code: str) -> None:
    assert _code({"kind": "dataset", "dataset": "orders", "timezone": timezone}) == code


def _preimage(query: object) -> str:
    return build_protocol_cache_preimage(
        secret=SECRET,
        definition_identity=DEFINITION,
        query=query,
        tenant={"mode": "none"},
        row_limit=None,
    )


def _preimage_code(query: object) -> str:
    with pytest.raises(ProtocolCachePreimageError) as raised:
        _preimage(query)
    return raised.value.code


def test_preimage_refuses_non_empty_having() -> None:
    condition = {"measure": "revenue", "operator": "gt", "value": 1}
    assert _preimage_code(_query(having=[condition])) == "HQ_CACHE_PREIMAGE_INVALID_QUERY"


def test_preimage_treats_empty_having_as_absent() -> None:
    assert _preimage(_query(having=[])) == _preimage(_query())
    assert "having" not in _preimage(_query(having=[]))


@pytest.mark.parametrize("kind", ["dataset", "metric"])
def test_preimage_refuses_a_non_utc_timezone(kind: str) -> None:
    source: dict[str, object] = {"kind": kind, "dataset": "orders", "timezone": "Asia/Tokyo"}
    if kind == "metric":
        source["metric"] = "revenue"
    assert _preimage_code(source) == "HQ_CACHE_PREIMAGE_INVALID_QUERY"


@pytest.mark.parametrize("kind", ["dataset", "metric"])
def test_preimage_folds_utc_to_absent(kind: str) -> None:
    source: dict[str, object] = {"kind": kind, "dataset": "orders", "by": "day"}
    if kind == "metric":
        source["metric"] = "revenue"
    with_utc = _preimage({**source, "timezone": "UTC"})
    assert with_utc == _preimage(source)
    assert "timezone" not in with_utc

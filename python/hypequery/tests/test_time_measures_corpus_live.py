"""The cross-language window and shift corpus (RFC 0015) against a live ClickHouse.

TypeScript is the reference and generates `expected`
(`time-measures-corpus.test.ts`); Python must produce the same rows, column
order and refusals.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Iterator
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest

from hypequery.datasets import (
    Dataset,
    DatasetQuery,
    ExecutionContext,
    create_dataset_client,
    dataset,
    dimension,
    measure,
    tenant,
)
from hypequery.datasets.formulas import divide, null_if_zero, subtract
from hypequery.datasets.planner import CompiledQueryError
from hypequery.datasets.query_helpers import Filter, Order
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

pytestmark = pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)

CORPUS = json.loads(
    (
        Path(__file__).resolve().parents[3] / "specs/datasets/time-measures-corpus-v1.json"
    ).read_text()
)
DATABASE = "hq_time_corpus"
PORT = int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123"))
FORMULAS: dict[str, Callable[..., Any]] = {
    "subtract": subtract,
    "divide": divide,
    "nullIfZero": null_if_zero,
}
AGGREGATIONS = {"countDistinct": "count_distinct"}


def _formula(node: Any) -> Any:
    if isinstance(node, str):
        return node
    return FORMULAS[node["op"]](*(_formula(arg) for arg in node["args"]))


def _measure(spec: dict[str, Any]) -> Any:
    kind = spec.get("kind")
    if kind == "derived":
        return measure.derived(_formula(spec["formula"]))
    if kind == "shift":
        return measure.shift(spec["measure"], spec["interval"]["amount"], spec["interval"]["unit"])
    if kind == "window":
        if "trailing" in spec:
            trailing = spec["trailing"]
            return measure.trailing(spec["measure"], trailing["amount"], trailing["unit"])
        if "toDate" in spec:
            return measure.to_date(spec["measure"], spec["toDate"])
        return measure.cumulative(spec["measure"])
    aggregation = AGGREGATIONS.get(spec["aggregation"], spec["aggregation"])
    return getattr(measure, aggregation)(spec["field"])


def _dimension(spec: dict[str, Any]) -> Any:
    return getattr(dimension, spec["type"])(
        **({"column": spec["column"]} if "column" in spec else {})
    )


def _dataset(name: str, spec: dict[str, Any]) -> Dataset:
    return dataset(
        name,
        source=spec["source"],
        time_key=spec["timeKey"],
        tenant_key=spec.get("tenantKey"),
        dimensions={field: _dimension(d) for field, d in spec["dimensions"].items()},
        measures={field: _measure(m) for field, m in spec["measures"].items()},
    )


DATASETS = {name: _dataset(name, spec) for name, spec in CORPUS["datasets"].items()}


def _query(spec: dict[str, Any]) -> DatasetQuery:
    return DatasetQuery(
        by=spec.get("by"),
        measures=tuple(spec["measures"]),
        dimensions=tuple(spec.get("dimensions", ())),
        filters=tuple(Filter(**f) for f in spec.get("filters", ())),
        timezone=spec.get("timezone"),
        order_by=tuple(Order(**o) for o in spec.get("orderBy", ())),
        limit=spec.get("limit"),
        offset=spec.get("offset"),
    )


def _wire(value: object) -> object:
    """The HTTP spelling TypeScript returns: measure values as strings."""

    if value is None or isinstance(value, str):
        return value
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, int | float | Decimal):
        return str(value)
    raise AssertionError(f"unexpected value {value!r}")


@pytest.fixture(scope="module")
def client() -> Iterator[Any]:
    import clickhouse_connect

    password = os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"]
    host = os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"]
    admin = clickhouse_connect.get_client(
        host=host, port=PORT, username="default", password=password
    )
    admin.command(f"DROP DATABASE IF EXISTS {DATABASE}")
    admin.command(f"CREATE DATABASE {DATABASE}")
    for table, spec in CORPUS["tables"].items():
        admin.command(f"CREATE TABLE {DATABASE}.{table} {spec['columns']}")
        rows = "\n".join(json.dumps(row) for row in spec["rows"])
        admin.command(f"INSERT INTO {DATABASE}.{table} FORMAT JSONEachRow\n{rows}")
    executor = create_clickhouse_executor(
        ClickHouseConnection(
            host=host, port=PORT, database=DATABASE, username="default", password=password
        )
    )
    yield create_dataset_client(executor=executor)
    executor.close()
    admin.command(f"DROP DATABASE IF EXISTS {DATABASE}")


@pytest.mark.parametrize("case", CORPUS["cases"], ids=lambda case: case["name"])
def test_python_matches_the_reference_corpus(client: Any, case: dict[str, Any]) -> None:
    context = ExecutionContext(tenant=tenant(case["tenant"])) if "tenant" in case else None
    expected = case["expected"]
    target, query = DATASETS[case["dataset"]], _query(case["query"])
    if "error" in expected:
        with pytest.raises(CompiledQueryError) as raised:
            client.execute(target, query, context=context)
        assert raised.value.category == "input-invalid"
        # TypeScript prefixes the same message.
        assert f"Invalid dataset query: {raised.value.message}" == expected["error"]
        return
    result = client.execute(target, query, context=context)
    rows = [{key: _wire(value) for key, value in row.items()} for row in result.data]
    assert {"rows": rows} == expected
    # Column order is part of the result, as it is over HTTP.
    assert [list(row) for row in rows] == [list(row) for row in expected["rows"]]

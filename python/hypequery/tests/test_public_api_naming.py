"""The public authoring surface: one namespaced spelling per helper.

Measures, filters, orderings and formulas are written through the `measure`,
`filter`, `order` and `formula` namespaces. The package does not re-export the
loose helpers they wrap, so nothing it exports shadows a Python builtin except
the `filter` namespace itself.
"""

from __future__ import annotations

import builtins
import subprocess
import sys
from collections.abc import Callable
from typing import cast

import pytest
from pydantic import ValidationError

import hypequery.datasets as definitions
from hypequery.datasets import (
    Dataset,
    Dimension,
    DimensionType,
    Measure,
    aggregations,
    create_memory_cache_store,
    dataset,
    dimension,
    filter,  # noqa: A004 - the canonical filter namespace
    formula,
    formulas,
    measure,
    order,
    query_helpers,
)


def test_dataset_authoring_matches_the_model_constructor() -> None:
    authored = dataset(
        "orders",
        source="orders",
        tenant_key="tenant_id",
        time_key="created_at",
        dimensions={"country": dimension.string(label="Country")},
        measures={"revenue": measure.sum("amount", filters=(filter.eq("status", "paid"),))},
    )
    constructed = Dataset(
        name="orders",
        source="orders",
        tenant_key="tenant_id",
        time_key="created_at",
        dimensions={"country": dimension("string", label="Country")},
        measures={
            "revenue": measure(
                aggregations.sum("amount"), filters=(query_helpers.eq("status", "paid"),)
            )
        },
    )
    assert authored.model_dump() == constructed.model_dump()
    assert authored.filters["country"].field == "country"
    assert order.desc("revenue") == query_helpers.desc("revenue")
    assert dataset("orders", source="orders", dimensions={}, filters={}).filters == {}


REMOVED_TOP_LEVEL = (
    *("sum", "count", "count_distinct", "avg", "min", "max", "median", "percentile"),
    *("arg_max", "arg_min", "stddev", "variance"),
    *("eq", "neq", "gt", "gte", "lt", "lte", "in_list", "not_in_list", "between", "like"),
    *("asc", "desc"),
    *("add", "subtract", "multiply", "divide", "null_if_zero", "coalesce", "round"),
    *("floor", "ceil"),
)


@pytest.mark.parametrize("name", REMOVED_TOP_LEVEL)
def test_loose_helpers_are_not_package_exports(name: str) -> None:
    assert name not in definitions.__all__
    assert not hasattr(definitions, name)


def test_only_the_filter_namespace_shares_a_builtin_name() -> None:
    assert [name for name in definitions.__all__ if hasattr(builtins, name)] == ["filter"]


@pytest.mark.parametrize(
    "name",
    ["add", "subtract", "multiply", "divide", "null_if_zero", "coalesce", "round", "floor", "ceil"],
)
def test_formula_namespace_wraps_every_formula_helper(name: str) -> None:
    assert getattr(formula, name) is getattr(formulas, name)


def test_formula_namespace_builds_derived_measures() -> None:
    orders = dataset(
        "orders",
        source="orders",
        dimensions={"amount": dimension.number()},
        measures={
            "revenue": measure.sum("amount"),
            "orders": measure.count("amount"),
            "average": measure.derived(
                formula.round(formula.divide("revenue", formula.null_if_zero("orders")), 2)
            ),
        },
    )
    assert set(orders.measures) == {"revenue", "orders", "average"}


@pytest.mark.parametrize("kind", ["string", "number", "boolean", "timestamp"])
def test_dimension_helpers_retain_metadata(kind: str) -> None:
    helper: Callable[..., Dimension] = getattr(dimension, kind)
    assert helper(column="physical", label="Label", groupable=False) == dimension(
        cast(DimensionType, kind),
        column="physical",
        label="Label",
        groupable=False,
    )


@pytest.mark.parametrize(
    "name",
    [
        "sum",
        "count",
        "count_distinct",
        "avg",
        "min",
        "max",
        "median",
        "stddev",
        "variance",
        "percentile",
        "arg_max",
        "arg_min",
    ],
)
def test_measure_helpers_match_their_aggregations(name: str) -> None:
    aggregation: Callable[..., aggregations.Aggregation] = getattr(aggregations, name)
    helper: Callable[..., Measure] = getattr(measure, name)
    extra: tuple[object, ...] = (
        (0.9,)
        if name == "percentile"
        else (("created_at",) if name in ("arg_max", "arg_min") else ())
    )
    assert helper("amount", *extra, label="Amount") == measure(
        aggregation("amount", *extra),
        label="Amount",
    )


def test_public_helpers_do_not_bypass_validation() -> None:
    from hypequery.protocol.errors import ProtocolIdentifierError

    with pytest.raises(ProtocolIdentifierError):
        dataset("bad name", source="orders", dimensions={})
    with pytest.raises(ValidationError):
        measure.percentile("amount", 2)
    with pytest.raises(ValidationError):
        measure.arg_max("amount", "created_at", filters=(filter.eq("status", "paid"),))
    with pytest.raises(ValidationError):
        dimension.string(column="")
    with pytest.raises(ValueError, match="max_entries must be a positive integer"):
        create_memory_cache_store(max_entries=0)


def test_definition_helpers_stay_framework_free() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; "
            "from hypequery.datasets import dataset, dimension, measure, filter, order; "
            "assert not {'fastapi', 'uvicorn', 'clickhouse_connect'} & sys.modules.keys()",
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def test_serve_dev_preserves_existing_runner() -> None:
    from hypequery.serve import run_dev, serve_dev
    from hypequery.serve.dev import serve_dev as module_serve_dev

    assert serve_dev is run_dev
    assert module_serve_dev is serve_dev


def test_serve_api_and_transport_names_preserve_runtime_checks() -> None:
    from hypequery.serve import (
        HttpSecurity,
        create_api,
        create_app,
        create_router,
        run_production,
        start_server,
    )

    # The TypeScript-matching names are the definitions; the others are aliases.
    assert create_router is create_api
    assert create_api.__name__ == "create_api"
    assert run_production is start_server
    assert start_server.__name__ == "start_server"
    app = create_app(
        create_api(authenticate=lambda credential: None),
        security=HttpSecurity(allowed_hosts=("testserver",)),
    )
    with pytest.raises(ValueError, match="ProductionProfile"):
        start_server(app)


def test_serving_aliases_are_in_module_exports() -> None:
    from hypequery.serve import dev, router

    assert {"run_dev", "serve_dev"} <= set(dev.__all__)
    assert {"create_router", "create_api"} <= set(router.__all__)

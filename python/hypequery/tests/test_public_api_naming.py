"""Cross-language authoring names retain validation and existing call forms."""

from __future__ import annotations

import subprocess
import sys
from collections.abc import Callable
from typing import cast

import pytest
from pydantic import ValidationError

from hypequery.datasets import (
    Aggregation,
    Dataset,
    Dimension,
    DimensionType,
    Measure,
    create_memory_cache_store,
    dataset,
    desc,
    dimension,
    eq,
    filter,  # noqa: A004
    measure,
    order,
    sum,  # noqa: A004
)


def test_dataset_authoring_and_existing_calls_match() -> None:
    modern = dataset(
        "orders",
        source="orders",
        tenant_key="tenant_id",
        time_key="created_at",
        dimensions={"country": dimension.string(label="Country")},
        measures={"revenue": measure.sum("amount", filters=(filter.eq("status", "paid"),))},
    )
    existing = Dataset(
        name="orders",
        source="orders",
        tenant_key="tenant_id",
        time_key="created_at",
        dimensions={"country": dimension("string", label="Country")},
        measures={"revenue": measure(sum("amount"), filters=(eq("status", "paid"),))},
    )
    assert modern.model_dump() == existing.model_dump()
    assert modern.filters["country"].field == "country"
    assert order.desc("revenue") == desc("revenue")
    assert dataset("orders", source="orders", dimensions={}, filters={}).filters == {}


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
def test_measure_helpers_match_existing_aggregations(name: str) -> None:
    import hypequery.datasets as definitions

    aggregation: Callable[..., Aggregation] = getattr(definitions, name)
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
        measure.arg_max("amount", "created_at", filters=(eq("status", "paid"),))
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

    assert create_api is create_router
    assert start_server is run_production
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

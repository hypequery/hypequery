"""Allowed grains constrain planning, HTTP schemas, and publication."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from hypequery.datasets import (
    CachedRows,
    Dataset,
    DatasetQuery,
    build_protocol_dataset_contract,
    create_dataset_client,
    create_dataset_registry,
    dataset,
    dimension,
    get_dataset_catalog,
    measure,
    plan_dataset_query,
    serialize_semantic_contract,
)
from hypequery.datasets.client.results import ResultRows
from hypequery.datasets.planner import CompiledQuery, CompiledQueryError
from hypequery.serve import (
    HttpSecurity,
    Principal,
    add_dataset_endpoint,
    add_discovery_endpoint,
    add_metric_endpoint,
    create_app,
    create_router,
)


def events() -> Dataset:
    return dataset(
        "events",
        source="events",
        time_key="day",
        time_grains=("day", "month"),
        dimensions={"day": dimension.timestamp()},
        measures={"rows": measure.count("day")},
    )


@pytest.mark.parametrize("grains", [(), ("hour", "hour"), ("bad",)])
def test_reject_invalid_definition(grains: tuple[str, ...]) -> None:
    with pytest.raises(ValidationError):
        Dataset.model_validate({**events().model_dump(), "time_grains": grains})
    with pytest.raises(ValidationError):
        Dataset.model_validate({**events().model_dump(), "time_key": None})


def test_allowed_grains_reach_catalog_contract_and_planner() -> None:
    ds = events()
    registry = create_dataset_registry(ds)
    assert get_dataset_catalog(ds, registry=registry)["supportedGrains"] == ["day", "month"]
    contract = serialize_semantic_contract(registry)
    assert contract["datasets"]["events"]["supportedGrains"] == ["day", "month"]  # type: ignore[index]
    assert "toStartOfMonth" in plan_dataset_query(ds, DatasetQuery(by="month")).sql
    with pytest.raises(CompiledQueryError, match="requested time grain"):
        plan_dataset_query(ds, DatasetQuery(by="hour"))
    # The current wire contract cannot carry this restriction; never silently drop it.
    with pytest.raises(ValueError, match="deployment contract 2"):
        build_protocol_dataset_contract(ds)


class Executor:
    def __init__(self) -> None:
        self.calls = 0

    def execute(self, query: CompiledQuery) -> ResultRows:
        self.calls += 1
        return CachedRows(columns=("rows",), rows=((1,),))


def test_http_restrictions_and_openapi() -> None:
    ds = events()
    executor = Executor()
    client = create_dataset_client(executor=executor)
    router = create_router(authenticate=lambda credential: Principal(subject="reader"))
    add_dataset_endpoint(router, "/dataset", dataset=ds, client=client)
    add_metric_endpoint(router, "/metric", dataset=ds, client=client, measure="rows")
    add_discovery_endpoint(router, registry=create_dataset_registry(ds))
    with TestClient(
        create_app(
            router, development_docs=True, security=HttpSecurity(allowed_hosts=("testserver",))
        )
    ) as http:
        headers = {"Authorization": "Bearer test"}
        for path in ("/dataset", "/metric"):
            assert http.post(path, headers=headers, json={"by": "hour"}).status_code == 400
            assert http.post(path, headers=headers, json={"by": "day"}).status_code == 200
        assert executor.calls == 2
        discovery = http.get("/discovery", headers=headers).json()
        assert discovery["datasets"][0]["supportedGrains"] == ["day", "month"]
        schemas = http.get("/openapi.json").json()["components"]["schemas"]
        for name in ("DatasetQuery_events", "MetricQuery_events"):
            assert schemas[name]["properties"]["by"]["enum"] == ["day", "month", None]


def test_shared_grain_fixture() -> None:
    import json
    from pathlib import Path

    rows = json.loads(
        (Path(__file__).resolve().parents[3] / "specs/datasets/time-grains-v1.json").read_text()
    )
    for row in rows:
        ds = Dataset.model_validate({**events().model_dump(), "time_grains": tuple(row["allowed"])})
        assert (
            get_dataset_catalog(ds, registry=create_dataset_registry(ds))["supportedGrains"]
            == row["allowed"]
        )
        for grain in row["accepted"]:
            plan_dataset_query(ds, DatasetQuery(by=grain))
        for grain in row["rejected"]:
            with pytest.raises(CompiledQueryError):
                plan_dataset_query(ds, DatasetQuery(by=grain))

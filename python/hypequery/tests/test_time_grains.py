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


@pytest.mark.parametrize(
    ("grains", "message"),
    [
        ((), "non-empty"),
        (("hour", "hour"), "duplicates"),
        (("second",), 'unsupported time grain "second"'),
    ],
)
def test_reject_invalid_definition(grains: tuple[str, ...], message: str) -> None:
    # Mirrors TypeScript's "is validated when the dataset is defined".
    with pytest.raises(ValidationError, match=message):
        Dataset.model_validate({**events().model_dump(), "time_grains": grains})


def test_time_grains_require_a_time_key() -> None:
    with pytest.raises(ValidationError, match="requires the dataset to define time_key"):
        Dataset.model_validate({**events().model_dump(), "time_key": None})


def test_allowed_grains_reach_catalog_contract_and_planner() -> None:
    ds = events()
    registry = create_dataset_registry(ds)
    assert get_dataset_catalog(ds, registry=registry)["supportedGrains"] == ["day", "month"]
    contract = serialize_semantic_contract(registry)
    assert contract["datasets"]["events"]["supportedGrains"] == ["day", "month"]  # type: ignore[index]
    assert "toStartOfMonth" in plan_dataset_query(ds, DatasetQuery(by="month")).sql
    with pytest.raises(
        CompiledQueryError, match=r'Unsupported time grain "hour"\. Supported: day, month'
    ):
        plan_dataset_query(ds, DatasetQuery(by="hour"))
    # The current wire contract cannot carry this restriction; never silently drop it.
    with pytest.raises(
        ValueError,
        match=r'Dataset "events" time_grains excludes week, quarter, year.*cannot preserve',
    ):
        build_protocol_dataset_contract(ds)


@pytest.mark.parametrize(
    "grains",
    [
        ("day", "week", "month", "quarter", "year"),
        ("minute", "hour", "day", "week", "month", "quarter", "year"),
    ],
)
def test_a_policy_covering_every_portable_grain_publishes_unchanged(
    grains: tuple[str, ...],
) -> None:
    # Mirrors TypeScript's "publishes an explicit grain list when it includes every
    # portable grain": contract 2 then loses nothing a deployment could serve.
    restricted = Dataset.model_validate({**events().model_dump(), "time_grains": grains})
    unrestricted = Dataset.model_validate({**events().model_dump(), "time_grains": None})
    assert build_protocol_dataset_contract(restricted) == build_protocol_dataset_contract(
        unrestricted
    )


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
        rejected = http.post("/dataset", headers=headers, json={"by": "hour"})
        assert "Unsupported time grain" in rejected.text
        # Discovery is TypeScript's agent-safe projection, which has no dataset grains;
        # the policy is published through the catalog, contract and OpenAPI instead.
        discovery = http.get("/discovery", headers=headers).json()
        assert "supportedGrains" not in discovery["datasets"][0]
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
        registry = create_dataset_registry(ds)
        assert get_dataset_catalog(ds, registry=registry)["supportedGrains"] == row["allowed"]
        contract = serialize_semantic_contract(registry)
        assert contract["datasets"]["events"]["supportedGrains"] == row["contract"]  # type: ignore[index]
        for grain in row["accepted"]:
            plan_dataset_query(ds, DatasetQuery(by=grain))
        for grain in row["rejected"]:
            supported = ", ".join(row["allowed"])
            with pytest.raises(CompiledQueryError) as raised:
                plan_dataset_query(ds, DatasetQuery(by=grain))
            assert str(raised.value).endswith(
                f'Unsupported time grain "{grain}". Supported: {supported}'
            )
        if row["publishable"]:
            build_protocol_dataset_contract(ds)
        else:
            with pytest.raises(ValueError, match="cannot preserve dataset-level grain"):
                build_protocol_dataset_contract(ds)

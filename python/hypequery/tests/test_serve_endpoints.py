"""Execution, policy, metadata, and discovery over real FastAPI HTTP routing."""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass, field
from typing import Any

import pytest
from fastapi.testclient import TestClient

from hypequery.datasets import (
    CompiledQuery,
    Dataset,
    DatasetLimits,
    DatasetQuery,
    count,
    create_async_dataset_client,
    create_dataset_client,
    create_dataset_registry,
    dimension,
    measure,
)
from hypequery.datasets.cache import MemoryCacheStore, ResultCache
from hypequery.datasets.client import ResultScalar
from hypequery.serve import (
    Credential,
    DiagnosticAccess,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    QueryEvents,
    add_dataset_endpoint,
    add_discovery_endpoint,
    add_metric_endpoint,
    create_api,
    create_app,
    create_dataset_endpoint,
    create_metric_endpoint,
    create_router,
)


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


@dataclass
class Executor:
    seen: list[CompiledQuery] = field(default_factory=list)
    error: bool = False

    def execute(self, compiled: CompiledQuery) -> Rows:
        self.seen.append(compiled)
        if self.error:
            raise RuntimeError("LEAK_DRIVER_SECRET")
        match = re.search(r"LIMIT (\d+)(?: OFFSET (\d+))?$", compiled.sql)
        assert match
        limit, offset = int(match[1]), int(match[2] or 0)
        columns = tuple(re.findall(r" AS `([^`]+)`", compiled.sql))
        values: dict[str, ResultScalar] = {"country": "US", "total": 10}
        rows = tuple(tuple(values.get(name, 1) for name in columns) for _ in range(3))
        return Rows(columns, rows[offset : offset + limit])


@dataclass
class AsyncExecutor:
    inner: Executor

    async def execute(self, compiled: CompiledQuery) -> Rows:
        await asyncio.sleep(0)
        return self.inner.execute(compiled)


def dataset(*, tenant: bool = False, max_size: int | None = None) -> Dataset:
    return Dataset(
        name="orders",
        source="private_orders",
        tenant_key="private_tenant" if tenant else None,
        dimensions={"country": dimension("string", column="private_country")},
        measures={"total": measure(count("private_id"))},
        limits=DatasetLimits(max_result_size=max_size) if max_size is not None else None,
    )


def authenticate(credential: Credential) -> Principal | None:
    if credential.value == "reader":
        return Principal(subject="alice", tenant_id="TENANT_SECRET", scopes=frozenset({"read"}))
    if credential.value == "admin":
        return Principal(subject="bob", tenant_id="TENANT_SECRET", roles=frozenset({"admin"}))
    if credential.value == "tenantless":
        return Principal(subject="anonymous-tenant")
    return None


DEFAULT_POLICY = EndpointPolicy()


def app(
    *,
    policy: EndpointPolicy = DEFAULT_POLICY,
    tenant: bool = False,
    max_size: int | None = None,
    async_client: bool = False,
    diagnostics: DiagnosticAccess | None = None,
    events: QueryEvents | None = None,
) -> tuple[TestClient, Executor]:
    executor = Executor()
    model = dataset(tenant=tenant, max_size=max_size)
    client = (
        create_async_dataset_client(executor=AsyncExecutor(executor))
        if async_client
        else create_dataset_client(executor=executor)
    )
    router = create_router(authenticate=authenticate)
    add_dataset_endpoint(
        router,
        "/datasets/orders/query",
        dataset=model,
        client=client,
        policy=policy,
        diagnostics=diagnostics,
        events=events,
    )
    add_metric_endpoint(
        router, "/metrics/total", dataset=model, measure="total", client=client, policy=policy
    )
    add_discovery_endpoint(router, registry=create_dataset_registry(model))
    application = create_app(router, security=HttpSecurity(allowed_hosts=("testserver",)))
    return TestClient(application, raise_server_exceptions=False), executor


@pytest.mark.parametrize("async_client", [False, True])
def test_pagination_overfetch_and_public_metadata(async_client: bool) -> None:
    client, executor = app(async_client=async_client)
    response = client.post(
        "/datasets/orders/query",
        headers={"Authorization": "Bearer reader"},
        json={"dimensions": ["country"], "limit": 2, "includeMeta": True},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["data"]) == 2
    assert body["meta"]["pagination"] == {"limit": 2, "offset": 0, "hasMore": True}
    assert executor.seen[0].sql.endswith("LIMIT 3")
    assert body["meta"]["rowCount"] == 2
    assert set(body["meta"]) == {"requestId", "rowCount", "timingMs", "pagination", "cache"}
    assert body["meta"]["requestId"] == response.headers["x-request-id"]
    assert response.headers["cache-control"] == "no-store"
    assert "private_" not in response.text
    assert "TENANT_SECRET" not in response.text


@pytest.mark.parametrize(
    ("payload", "expected"),
    [
        (
            {"limit": 2, "offset": 2, "includeMeta": True},
            {"limit": 2, "offset": 2, "hasMore": False},
        ),
        ({"limit": 999, "includeMeta": True}, {"limit": 2, "offset": 0, "hasMore": True}),
    ],
)
def test_zero_last_page_and_definition_cap(
    payload: dict[str, Any], expected: dict[str, Any]
) -> None:
    client, _ = app(max_size=2)
    response = client.post(
        "/datasets/orders/query", headers={"Authorization": "Bearer reader"}, json=payload
    )
    assert response.status_code == 200, response.text
    assert response.json()["meta"]["pagination"] == expected


@pytest.mark.parametrize(
    "payload",
    [
        {"limit": 0},
        {"limit": "2"},
        {"limit": True},
        {"limit": 2.0},
        {"offset": -1},
        {"includeMeta": "true"},
        {"tenant": "other"},
        {"roles": ["admin"]},
        {"settings": {}},
        {"sql": "SELECT 1"},
        {"filters": [{"field": "country", "operator": "eq", "value": "x", "extra": 1}]},
        {"orderBy": [{"field": "country", "direction": 1}]},
        {"filters": [{"field": "bad-name", "operator": "eq", "value": "x"}]},
        {"orderBy": [{"field": "bad-name", "direction": "asc"}]},
        {"dimensions": ["missing"]},
    ],
)
def test_invalid_requests_never_execute(payload: dict[str, Any]) -> None:
    client, executor = app()
    response = client.post(
        "/datasets/orders/query", headers={"Authorization": "Bearer reader"}, json=payload
    )
    assert response.status_code == 400, response.text
    assert not executor.seen


def test_authentication_precedes_parsing_and_policy_denies_execution() -> None:
    client, executor = app(
        policy=EndpointPolicy(required_roles=frozenset({"admin"}), tenant="required")
    )
    response = client.post(
        "/datasets/orders/query", content="{broken", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 401
    for credential in ("reader", "tenantless"):
        response = client.post(
            "/datasets/orders/query", json={}, headers={"Authorization": "Bearer " + credential}
        )
        assert response.status_code == 403
    assert not executor.seen


def test_tenant_required_and_filter_values_are_bound() -> None:
    client, executor = app(tenant=True)
    denied = client.post(
        "/datasets/orders/query", json={}, headers={"Authorization": "Bearer tenantless"}
    )
    assert denied.status_code == 403
    response = client.post(
        "/datasets/orders/query",
        headers={"Authorization": "Bearer reader"},
        json={"filters": [{"field": "country", "operator": "eq", "value": "x'y"}]},
    )
    assert response.status_code == 200, response.text
    compiled = executor.seen[0]
    assert "TENANT_SECRET" not in compiled.sql
    assert "x'y" not in compiled.sql
    assert set(compiled.parameter_values().values()) == {"TENANT_SECRET", "x'y"}
    assert "meta" not in response.json()


def test_metric_fixes_measure_and_rejects_overrides() -> None:
    client, executor = app()
    response = client.post("/metrics/total", json={}, headers={"Authorization": "Bearer reader"})
    assert response.status_code == 200
    assert set(response.json()["data"][0]) == {"total"}
    for measures in (["total"], [], None):
        response = client.post(
            "/metrics/total",
            json={"measures": measures},
            headers={"Authorization": "Bearer reader"},
        )
        assert response.status_code == 400
    assert len(executor.seen) == 1


def test_diagnostics_require_host_permission_and_successful_audit() -> None:
    audits: list[str] = []
    access = DiagnosticAccess(
        authorize=lambda principal: "admin" in principal.roles,
        audit=lambda principal, request_id: audits.append(request_id),
    )
    client, _ = app(diagnostics=access, tenant=True)
    for credential in ("reader", "admin"):
        response = client.post(
            "/datasets/orders/query",
            json={"includeMeta": True},
            headers={"Authorization": "Bearer " + credential},
        )
        assert response.status_code == 200, response.text
        assert ("diagnostics" in response.json()) == (credential == "admin")
        assert "TENANT_SECRET" not in response.text
    assert len(audits) == 1

    def failed_audit(principal: Principal, request_id: str) -> None:
        raise RuntimeError("AUDIT_SECRET")

    client, _ = app(diagnostics=DiagnosticAccess(authorize=lambda _: True, audit=failed_audit))
    response = client.post(
        "/datasets/orders/query",
        json={"includeMeta": True},
        headers={"Authorization": "Bearer admin"},
    )
    assert response.status_code == 500
    assert "private_" not in response.text
    assert "AUDIT_SECRET" not in response.text


def test_event_success_failure_and_sink_failure_are_metadata_only() -> None:
    records: list[dict[str, object]] = []
    events = QueryEvents(target={"project": "sdk", "environment": "test"}, sink=records.append)
    client, executor = app(events=events, tenant=True)
    assert (
        client.post(
            "/datasets/orders/query", json={}, headers={"Authorization": "Bearer reader"}
        ).status_code
        == 200
    )
    executor.error = True
    response = client.post(
        "/datasets/orders/query", json={}, headers={"Authorization": "Bearer reader"}
    )
    assert response.status_code == 500
    assert [event["outcome"] for event in records] == ["success", "failure"]
    serialized = json.dumps(records)
    for marker in (
        "private_",
        "TENANT_SECRET",
        "LEAK_DRIVER_SECRET",
        "country",
        "data",
        "sql",
        "parameters",
    ):
        assert marker not in serialized

    def broken_sink(event: dict[str, object]) -> None:
        raise RuntimeError("TELEMETRY_SECRET")

    events = QueryEvents(target={"project": "sdk", "environment": "test"}, sink=broken_sink)
    client, _ = app(events=events)
    assert (
        client.post(
            "/datasets/orders/query", json={}, headers={"Authorization": "Bearer reader"}
        ).status_code
        == 200
    )


def test_dev_docs_enumerate_models_and_public_discovery_is_explicit() -> None:
    model = dataset()
    router = create_router(authenticate=authenticate)
    add_dataset_endpoint(
        router, "/query", dataset=model, client=create_dataset_client(executor=Executor())
    )
    add_discovery_endpoint(
        router, registry=create_dataset_registry(model), policy=EndpointPolicy(public=True)
    )
    client = TestClient(
        create_app(
            router, security=HttpSecurity(allowed_hosts=("testserver",)), development_docs=True
        )
    )
    assert client.get("/discovery").status_code == 200
    schema = client.get("/openapi.json").json()
    assert schema["components"]["schemas"]["QueryRequest"]["additionalProperties"] is False
    assert "PublicQueryMeta" in schema["components"]["schemas"]


def test_paginated_cache_never_reuses_non_overfetched_rows() -> None:
    executor = Executor()
    cache = ResultCache(store=MemoryCacheStore(), ttl_seconds=60)
    client = create_dataset_client(executor=executor, cache=cache)
    model = dataset()
    query = DatasetQuery(limit=2)
    plain = client.execute(model, query)
    page = client.execute(model, query, paginate=True)
    hit = client.execute(model, query, paginate=True)
    assert plain.meta.pagination is None
    assert page.meta.pagination
    assert page.meta.pagination.has_more
    assert hit.meta.cache == "hit"
    assert hit.meta.pagination == page.meta.pagination
    assert len(executor.seen) == 2


def test_discovery_budget_and_invalid_endpoint_configuration_fail_at_startup() -> None:
    router = create_router(authenticate=authenticate)
    with pytest.raises(ValueError, match="byte budget"):
        add_discovery_endpoint(router, registry=create_dataset_registry(dataset()), max_bytes=1)
    with pytest.raises(ValueError, match="public"):
        app(policy=EndpointPolicy(public=True), tenant=True)
    with pytest.raises(ValueError, match="public"):
        EndpointPolicy(public=True, required_scopes=frozenset({"admin"}))


def test_request_lifetime_propagates_disconnect_and_closes_watcher() -> None:
    from fastapi import Request

    from hypequery.serve.lifetime import RequestLifetime

    async def receive() -> dict[str, Any]:
        return {"type": "http.disconnect"}

    async def check() -> None:
        request = Request({"type": "http", "method": "POST", "path": "/", "headers": []}, receive)
        async with RequestLifetime(request) as lifetime:
            await asyncio.sleep(0.01)
            assert lifetime.cancellation.is_set()
        assert not [task for task in asyncio.all_tasks() if task is not asyncio.current_task()]

    asyncio.run(check())


def test_handler_cancellation_reaches_executor_and_emits_aborted_event() -> None:
    from fastapi import Request

    from hypequery.serve.endpoints import DatasetEndpoint
    from hypequery.serve.models import QueryRequest

    class WaitingExecutor:
        compiled: CompiledQuery | None = None

        async def execute(self, compiled: CompiledQuery) -> Rows:
            self.compiled = compiled
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

    records: list[dict[str, object]] = []
    executor = WaitingExecutor()
    endpoint = DatasetEndpoint(
        dataset=dataset(),
        client=create_async_dataset_client(executor=executor),
        policy=EndpointPolicy(public=True),
        events=QueryEvents(target={"project": "sdk", "environment": "test"}, sink=records.append),
    )

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def check() -> None:
        request = Request({"type": "http", "method": "POST", "path": "/", "headers": []}, receive)
        task = asyncio.create_task(endpoint.execute(request, QueryRequest()))
        await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert executor.compiled is not None
        assert executor.compiled.cancellation is not None
        assert executor.compiled.cancellation.is_set()
        from hypequery.serve.utils.request_work import request_work

        await request_work(request).drain()
        assert records[0]["errorCategory"] == "aborted"
        assert not [task for task in asyncio.all_tasks() if task is not asyncio.current_task()]

    asyncio.run(check())


def test_named_metric_aliases_output_and_ordering() -> None:
    router = create_router(authenticate=authenticate)
    executor = Executor()
    add_metric_endpoint(
        router,
        "/metrics/orders",
        name="orders",
        measure="total",
        dataset=dataset(),
        client=create_dataset_client(executor=executor),
    )
    client = TestClient(create_app(router, security=HttpSecurity(allowed_hosts=("testserver",))))
    response = client.post(
        "/metrics/orders",
        json={"orderBy": [{"field": "orders", "direction": "desc"}]},
        headers={"Authorization": "Bearer reader"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"][0] == {"orders": "10"}
    assert "ORDER BY `total` DESC" in executor.seen[0].sql


@pytest.mark.parametrize("metric", [False, True])
def test_created_endpoints_install_with_the_same_auth_policy(metric: bool) -> None:
    api = create_api(authenticate=authenticate)
    model = dataset()
    client = create_dataset_client(executor=Executor())
    policy = EndpointPolicy(required_scopes=frozenset({"read"}))
    endpoint = (
        create_metric_endpoint(dataset=model, measure="total", client=client, policy=policy)
        if metric
        else create_dataset_endpoint(dataset=model, client=client, policy=policy)
    )
    assert api.routes == []
    endpoint.install(api, "/query")
    app = create_app(api, security=HttpSecurity(allowed_hosts=("testserver",)))
    with TestClient(app) as http:
        payload = {"dimensions": ["country"]}
        if not metric:
            payload["measures"] = ["total"]
        assert http.post("/query", json=payload).status_code == 401
        assert (
            http.post(
                "/query", json=payload, headers={"Authorization": "Bearer tenantless"}
            ).status_code
            == 403
        )
        response = http.post("/query", json=payload, headers={"Authorization": "Bearer reader"})
        assert response.status_code == 200, response.text
        assert response.json()["data"][0]["total"] == "10"

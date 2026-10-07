"""Beta qualification: trusted scopes through HTTP, joins and a shared cache."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from hypequery.datasets import (
    AsyncDatasetClient,
    Dataset,
    DatasetClient,
    MemoryCacheStore,
    ResultCache,
    belongs_to,
    create_async_dataset_client,
    create_dataset_client,
    create_dataset_registry,
    dimension,
    measure,
)
from hypequery.execution import (
    AsyncClickHouseExecutor,
    ClickHouseConnection,
    ClickHouseExecutor,
    create_async_clickhouse_executor,
    create_clickhouse_executor,
)
from hypequery.serve import (
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    ProductionProfile,
    add_dataset_endpoint,
    add_discovery_endpoint,
    add_metric_endpoint,
    create_app,
    create_router,
)


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ, reason="live ClickHouse required"
)
@pytest.mark.parametrize("asynchronous", [False, True], ids=["sync", "async"])
def test_live_tenant_http_joins_cache_and_denials(asynchronous: bool) -> None:
    import clickhouse_connect

    connection = ClickHouseConnection(
        host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
        port=int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123")),
        database="test_db",
        username="default",
        password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
    )
    admin = clickhouse_connect.get_client(
        host=connection.host,
        port=connection.port,
        username=connection.username,
        password=connection.password,
        database="test_db",
    )
    customer = Dataset(
        name="customers",
        source="test_db.beta_http_customers",
        tenant_key="org_id",
        dimensions={"id": dimension.number(), "label": dimension.string()},
    )
    orders = Dataset(
        name="orders",
        source="test_db.beta_http_orders",
        tenant_key="org_id",
        dimensions={"id": dimension.number()},
        measures={"total": measure.sum("amount")},
        relationships={"customer": belongs_to(customer, from_field="customer_id", to_field="id")},
    )
    registry = create_dataset_registry(orders, customer)
    cache = ResultCache(store=MemoryCacheStore(), ttl_seconds=60)
    router = create_router(authenticate=authenticate)
    policy = EndpointPolicy(tenant="required", required_scopes=frozenset({"analytics:read"}))
    try:
        admin.command("DROP TABLE IF EXISTS beta_http_orders")
        admin.command("DROP TABLE IF EXISTS beta_http_customers")
        admin.command(
            "CREATE TABLE beta_http_orders (id UInt64, customer_id UInt64, amount Float64, "
            "org_id String) ENGINE=Memory"
        )
        admin.command(
            "CREATE TABLE beta_http_customers (id UInt64, label String, "
            "org_id String) ENGINE=Memory"
        )
        admin.command("INSERT INTO beta_http_orders VALUES (1, 1, 10, 'a'), (1, 1, 90, 'b')")
        # Colliding join keys make a missing target scope visible immediately.
        admin.command(
            "INSERT INTO beta_http_customers VALUES (1, 'B_ONLY', 'b'), (1, 'A_ONLY', 'a')"
        )
        app = create_app(
            router,
            security=HttpSecurity(allowed_hosts=("testserver",)),
            production=ProductionProfile(),
        )
        with TestClient(app) as http:
            assert http.portal is not None
            executor: AsyncClickHouseExecutor | ClickHouseExecutor
            client: AsyncDatasetClient | DatasetClient
            if asynchronous:
                executor = http.portal.call(create_async_clickhouse_executor, connection)
                client = create_async_dataset_client(
                    executor=executor, registry=registry, cache=cache
                )
            else:
                executor = create_clickhouse_executor(connection)
                client = create_dataset_client(executor=executor, registry=registry, cache=cache)
            add_dataset_endpoint(router, "/query", dataset=orders, client=client, policy=policy)
            add_metric_endpoint(
                router, "/metric", dataset=orders, measure="total", client=client, policy=policy
            )
            add_discovery_endpoint(router, registry=registry, policy=policy)
            app.include_router(router)
            payload = {"dimensions": ["customer.label"], "measures": ["total"], "includeMeta": True}
            for org, label, total in (("a", "A_ONLY", "10"), ("b", "B_ONLY", "90")):
                headers = {"Authorization": "Bearer " + org, "x-tenant-id": "other"}
                first = http.post("/query", json=payload, headers=headers)
                assert first.status_code == 200, first.text
                assert first.json()["data"] == [{"customer.label": label, "total": total}]
                assert first.json()["meta"]["cache"] == {"hit": False}
                again = http.post("/query", json=payload, headers=headers)
                assert again.json()["data"] == first.json()["data"]
                assert again.json()["meta"]["cache"] == {"hit": True}
                metric = http.post("/metric", json={}, headers=headers)
                assert metric.json()["data"] == [{"total": total}]
                discovery = http.get("/discovery", headers=headers)
                assert discovery.status_code == 200
                for marker in ("org_id", "beta_http", "tenantKey", "parameters", "sql"):
                    assert marker not in discovery.text
                for forged in (
                    {"tenant": "other"},
                    {"context": {"tenant": "other"}},
                    {"filters": [{"field": "org_id", "operator": "eq", "value": "b"}]},
                ):
                    denied = http.post("/query", json=forged, headers=headers)
                    assert denied.status_code == 400, denied.text
                    assert denied.headers["cache-control"] == "no-store"
            # Authenticate the same subject with no tenant or insufficient scope;
            # warmed cache entries must never make either request authorized.
            for token, status in (("tenantless", 403), ("unprivileged", 403), ("invalid", 401)):
                headers = {"Authorization": "Bearer " + token}
                for path in ("/query", "/metric", "/discovery"):
                    response = (
                        http.get(path, headers=headers)
                        if path == "/discovery"
                        else http.post(path, json={}, headers=headers)
                    )
                    assert response.status_code == status, response.text
                    assert response.headers["cache-control"] == "no-store"
            if isinstance(executor, AsyncClickHouseExecutor):
                http.portal.call(executor.aclose)
            else:
                executor.close()
    finally:
        admin.command("DROP TABLE IF EXISTS beta_http_orders")
        admin.command("DROP TABLE IF EXISTS beta_http_customers")
        admin.close()


def authenticate(credential: Credential) -> Principal | None:
    if credential.value not in {"a", "b", "tenantless", "unprivileged"}:
        return None
    return Principal(
        subject="same-user",
        tenant_id=credential.value if credential.value in {"a", "b"} else None,
        scopes=frozenset() if credential.value == "unprivileged" else frozenset({"analytics:read"}),
    )

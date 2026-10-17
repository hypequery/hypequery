"""Caller-scoped metadata follows the same endpoint policies as execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Never

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hypequery.datasets import (
    ClientQueryProfile,
    CompiledQuery,
    Dataset,
    create_dataset_client,
    dimension,
    measure,
)
from hypequery.protocol import validate_protocol_client_contract
from hypequery.serve import (
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    add_metric_endpoint,
    create_api,
    create_app,
    export_client_contract,
)


@dataclass
class Executor:
    calls: list[CompiledQuery] = field(default_factory=list)

    def execute(self, query: CompiledQuery) -> Never:
        self.calls.append(query)
        raise AssertionError("discovery must not execute queries")


def authenticate(credential: Credential) -> Principal | None:
    if credential.value == "reader":
        return Principal(subject="alice", scopes=frozenset({"dataset"}))
    if credential.value == "metric":
        return Principal(subject="bob", scopes=frozenset({"metric"}))
    if credential.value == "viewer":
        return Principal(subject="viewer")
    return None


def setup(*, max_bytes: int = 256 * 1024) -> tuple[FastAPI, Executor]:
    router = create_api(authenticate=authenticate, prefix="/api")
    dataset = Dataset(
        name="orders",
        source="private_source_sentinel",
        dimensions={"country": dimension.string(column="private_column")},
        measures={"total": measure.count("country")},
    )
    executor = Executor()
    client = create_dataset_client(executor=executor)
    add_dataset_endpoint(
        router,
        "/orders",
        dataset=dataset,
        client=client,
        policy=EndpointPolicy(required_scopes=frozenset({"dataset"})),
        client_profile=ClientQueryProfile(),
    )
    add_metric_endpoint(
        router,
        "/sales",
        dataset=dataset,
        client=client,
        measure="total",
        name="sales",
        policy=EndpointPolicy(required_scopes=frozenset({"metric"})),
        client_profile=ClientQueryProfile(),
    )
    add_client_contract_endpoint(router, max_bytes=max_bytes)
    return create_app(router, security=HttpSecurity(allowed_hosts=("testserver",))), executor


@pytest.mark.parametrize(
    ("token", "expected"), [("reader", ["orders"]), ("metric", ["sales"]), ("viewer", [])]
)
def test_policy_scoped_signed_views_and_no_shared_cache(token: str, expected: list[str]) -> None:
    app, executor = setup()
    with TestClient(app) as http:
        response = http.get(
            "/api/client-contract?view=build&tenant=spoofed",
            headers={"Authorization": "Bearer " + token},
        )
    assert response.status_code == 200
    contract = validate_protocol_client_contract(response.json())
    assert contract["view"] == "authorized"
    assert [endpoint["id"] for endpoint in contract["endpoints"]] == expected
    assert response.headers["cache-control"] == "no-store"
    assert "authorization" in response.headers["vary"].lower()
    assert "private_source_sentinel" not in response.text
    assert "private_column" not in response.text
    assert "spoofed" not in response.text
    assert executor.calls == []


def test_schema_identity_survives_authorized_projection_but_denial_still_wins() -> None:
    app, executor = setup()
    build = export_client_contract(app)["contract"]
    with TestClient(app) as http:
        visible = http.get(
            "/api/client-contract", headers={"Authorization": "Bearer reader"}
        ).json()
        pin = visible["endpoints"][0]["schemaHash"]
        denied = http.post(
            "/api/orders",
            json={},
            headers={"Authorization": "Bearer viewer", "X-Hypequery-Client-Schema": pin},
        )
    assert visible["contentHash"] != build["contentHash"]
    assert pin == next(
        endpoint["schemaHash"] for endpoint in build["endpoints"] if endpoint["id"] == "orders"
    )
    assert denied.status_code == 403
    assert executor.calls == []


def test_unauthenticated_discovery_is_closed_and_oversize_is_not_truncated() -> None:
    app, executor = setup(max_bytes=1)
    with TestClient(app) as http:
        assert http.get("/api/client-contract").status_code == 401
        response = http.get("/api/client-contract", headers={"Authorization": "Bearer reader"})
    assert response.status_code == 503
    assert response.json()["error"]["message"] == "Client discovery is unavailable."
    assert "orders" not in response.text
    assert executor.calls == []


def test_custom_host_live_export_resolves_inclusion_paths() -> None:
    router = create_api(authenticate=authenticate)
    dataset = Dataset(name="orders", source="private", dimensions={"country": dimension.string()})
    executor = Executor()
    add_dataset_endpoint(
        router,
        "/orders",
        dataset=dataset,
        client=create_dataset_client(executor=executor),
        client_profile=ClientQueryProfile(),
    )
    add_client_contract_endpoint(router, routers=[router])
    app = FastAPI()
    app.include_router(router, prefix="/v2")
    with TestClient(app) as http:
        response = http.get("/v2/client-contract", headers={"Authorization": "Bearer reader"})
    assert response.status_code == 200
    assert response.json()["endpoints"][0]["path"] == "/v2/orders"


@pytest.mark.parametrize("limit", [True, 0, 1_048_577])
def test_discovery_budget_is_bounded_configuration(limit: int) -> None:
    router = create_api(authenticate=authenticate)
    with pytest.raises(ValueError, match="max_bytes"):
        add_client_contract_endpoint(router, max_bytes=limit)


def test_tenant_policy_is_applied_without_exposing_tenant_identity() -> None:
    def tenant_auth(credential: Credential) -> Principal:
        return Principal(
            subject="user",
            tenant_id="TENANT_VALUE_SECRET" if credential.value == "tenant" else None,
        )

    router = create_api(authenticate=tenant_auth)
    dataset = Dataset(
        name="orders",
        source="private",
        tenant_key="physical_tenant_key",
        dimensions={"country": dimension.string()},
    )
    add_dataset_endpoint(
        router,
        "/orders",
        dataset=dataset,
        client=create_dataset_client(executor=Executor()),
        policy=EndpointPolicy(tenant="required"),
        client_profile=ClientQueryProfile(),
    )
    add_client_contract_endpoint(router)
    app = create_app(router, security=HttpSecurity(allowed_hosts=("testserver",)))
    with TestClient(app) as http:
        absent = http.get("/client-contract", headers={"Authorization": "Bearer reader"})
        present = http.get("/client-contract", headers={"Authorization": "Bearer tenant"})
    assert absent.json()["endpoints"] == []
    assert [item["id"] for item in present.json()["endpoints"]] == ["orders"]
    assert "TENANT_VALUE_SECRET" not in present.text
    assert "physical_tenant_key" not in present.text


def test_explicit_public_discovery_projects_anonymous_capabilities_only() -> None:
    router = create_api(authenticate=authenticate)
    client = create_dataset_client(executor=Executor())
    for name, public in [("privateOrders", False), ("publicOrders", True)]:
        dataset = Dataset(name=name, source="private", dimensions={"country": dimension.string()})
        add_dataset_endpoint(
            router,
            "/" + name,
            dataset=dataset,
            client=client,
            policy=EndpointPolicy(public=public),
            client_profile=ClientQueryProfile(),
        )
    add_client_contract_endpoint(router, policy=EndpointPolicy(public=True))
    app = create_app(router, security=HttpSecurity(allowed_hosts=("testserver",)))
    with TestClient(app) as http:
        response = http.get("/client-contract")
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["endpoints"]] == ["publicOrders"]
    assert response.headers["cache-control"] == "no-store"


def test_each_target_is_authenticated_by_its_own_router() -> None:
    def admin_auth(credential: Credential) -> Principal | None:
        return Principal(subject="admin") if credential.value in ("admin", "both") else None

    def reader_auth(credential: Credential) -> Principal | None:
        return Principal(subject="user") if credential.value in ("reader", "both") else None

    main = create_api(authenticate=reader_auth)
    admin = create_api(authenticate=admin_auth, prefix="/admin")
    for router, name in ((main, "orders"), (admin, "payroll")):
        add_dataset_endpoint(
            router,
            "/" + name,
            dataset=Dataset(name=name, source="private", dimensions={"id": dimension.string()}),
            client=create_dataset_client(executor=Executor()),
            client_profile=ClientQueryProfile(),
        )
    add_client_contract_endpoint(main, routers=[main, admin])
    app = FastAPI()
    app.include_router(main)
    app.include_router(admin)
    with TestClient(app) as http:
        reader = http.get("/client-contract", headers={"Authorization": "Bearer reader"})
        both = http.get("/client-contract", headers={"Authorization": "Bearer both"})
    assert [item["id"] for item in reader.json()["endpoints"]] == ["orders"]
    assert "payroll" not in reader.text
    assert [item["id"] for item in both.json()["endpoints"]] == ["orders", "payroll"]


def test_public_targets_are_checked_without_the_callers_tenant() -> None:
    def tenant_auth(credential: Credential) -> Principal:
        return Principal(subject="user", tenant_id="tenant-a")

    router = create_api(authenticate=tenant_auth)
    add_dataset_endpoint(
        router,
        "/public",
        dataset=Dataset(name="public", source="private", dimensions={"id": dimension.string()}),
        client=create_dataset_client(executor=Executor()),
        policy=EndpointPolicy(public=True, tenant="forbidden"),
        client_profile=ClientQueryProfile(),
    )
    add_client_contract_endpoint(router)
    app = create_app(router, security=HttpSecurity(allowed_hosts=("testserver",)))
    with TestClient(app) as http:
        response = http.get("/client-contract", headers={"Authorization": "Bearer any"})
    assert [item["id"] for item in response.json()["endpoints"]] == ["public"]

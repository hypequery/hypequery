"""Caller-scoped metadata follows the same endpoint policies as execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Never

import pytest

from asgi_client import AsgiClient
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
    AsgiApp,
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    add_metric_endpoint,
    create_api,
    export_client_contract,
    to_asgi_app,
)

SECURITY = HttpSecurity(allowed_hosts=("testserver",))


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


def setup(*, max_bytes: int = 256 * 1024, described: bool = False) -> tuple[AsgiApp, Executor]:
    router = create_api(auth=authenticate, base_path="/api", security=SECURITY)
    dataset = Dataset(
        name="orders",
        source="private_source_sentinel",
        description="Customer orders." if described else None,
        dimensions={"country": dimension.string(column="private_column")},
        measures={
            "total": measure.count("country", label="Sales" if described else None),
        },
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
    return to_asgi_app(router), executor


@pytest.mark.parametrize(
    ("token", "expected"), [("reader", ["orders"]), ("metric", ["sales"]), ("viewer", [])]
)
def test_policy_scoped_signed_views_and_no_shared_cache(token: str, expected: list[str]) -> None:
    app, executor = setup()
    with AsgiClient(app) as http:
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
    build = export_client_contract(app.api)["contract"]
    with AsgiClient(app) as http:
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


def test_authorized_view_carries_annotations_without_changing_the_pin() -> None:
    app, _ = setup(described=True)
    plain, _ = setup()
    with AsgiClient(app) as http:
        visible = http.get("/api/client-contract", headers={"Authorization": "Bearer metric"})
    (endpoint,) = validate_protocol_client_contract(visible.json())["endpoints"]
    assert endpoint["annotations"] == {
        "description": "Customer orders.",
        "fields": {"sales": {"label": "Sales"}},
    }
    assert endpoint["schemaHash"] == next(
        item["schemaHash"]
        for item in export_client_contract(plain.api)["contract"]["endpoints"]
        if item["id"] == "sales"
    )


def test_unauthenticated_discovery_is_closed_and_oversize_is_not_truncated() -> None:
    app, executor = setup(max_bytes=1)
    with AsgiClient(app) as http:
        assert http.get("/api/client-contract").status_code == 401
        response = http.get("/api/client-contract", headers={"Authorization": "Bearer reader"})
    assert response.status_code == 503
    assert response.json()["error"]["message"] == "Client discovery is unavailable."
    assert "orders" not in response.text
    assert executor.calls == []


def test_a_mounted_api_names_its_mount_and_base_path() -> None:
    router = create_api(auth=authenticate, base_path="/v2", client_mount_path="/edge")
    dataset = Dataset(name="orders", source="private", dimensions={"country": dimension.string()})
    executor = Executor()
    add_dataset_endpoint(
        router,
        "/orders",
        dataset=dataset,
        client=create_dataset_client(executor=executor),
        client_profile=ClientQueryProfile(),
    )
    add_client_contract_endpoint(router)
    # Mounted as a host framework mounts an ASGI app: below a root_path.
    with AsgiClient(to_asgi_app(router), root_path="/edge") as http:
        response = http.get("/edge/v2/client-contract", headers={"Authorization": "Bearer reader"})
    assert response.status_code == 200
    assert response.json()["endpoints"][0]["path"] == "/edge/v2/orders"


@pytest.mark.parametrize("limit", [True, 0, 1_048_577])
def test_discovery_budget_is_bounded_configuration(limit: int) -> None:
    router = create_api(auth=authenticate)
    with pytest.raises(ValueError, match="max_bytes"):
        add_client_contract_endpoint(router, max_bytes=limit)


def test_tenant_policy_is_applied_without_exposing_tenant_identity() -> None:
    def tenant_auth(credential: Credential) -> Principal:
        return Principal(
            subject="user",
            tenant_id="TENANT_VALUE_SECRET" if credential.value == "tenant" else None,
        )

    router = create_api(auth=tenant_auth, security=SECURITY)
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
    with AsgiClient(to_asgi_app(router)) as http:
        absent = http.get("/client-contract", headers={"Authorization": "Bearer reader"})
        present = http.get("/client-contract", headers={"Authorization": "Bearer tenant"})
    assert absent.json()["endpoints"] == []
    assert [item["id"] for item in present.json()["endpoints"]] == ["orders"]
    assert "TENANT_VALUE_SECRET" not in present.text
    assert "physical_tenant_key" not in present.text


def test_explicit_public_discovery_projects_anonymous_capabilities_only() -> None:
    router = create_api(auth=authenticate, security=SECURITY)
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
    with AsgiClient(to_asgi_app(router)) as http:
        response = http.get("/client-contract")
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["endpoints"]] == ["publicOrders"]
    assert response.headers["cache-control"] == "no-store"


def test_public_targets_are_checked_without_the_callers_tenant() -> None:
    def tenant_auth(credential: Credential) -> Principal:
        return Principal(subject="user", tenant_id="tenant-a")

    router = create_api(auth=tenant_auth, security=SECURITY)
    add_dataset_endpoint(
        router,
        "/public",
        dataset=Dataset(name="public", source="private", dimensions={"id": dimension.string()}),
        client=create_dataset_client(executor=Executor()),
        policy=EndpointPolicy(public=True, tenant="forbidden"),
        client_profile=ClientQueryProfile(),
    )
    add_client_contract_endpoint(router)
    with AsgiClient(to_asgi_app(router)) as http:
        response = http.get("/client-contract", headers={"Authorization": "Bearer any"})
    assert [item["id"] for item in response.json()["endpoints"]] == ["public"]

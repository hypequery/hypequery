"""Discovery projection, endpoint policy, and application documentation policy."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from hypequery.datasets import (
    Dataset,
    DatasetRegistry,
    count,
    create_dataset_registry,
    dimension,
    measure,
)
from hypequery.serve import (
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_discovery_endpoint,
    create_app,
    create_router,
)


def authenticate(credential: Credential) -> Principal | None:
    return Principal(subject="alice") if credential.value == "reader" else None


def registry() -> DatasetRegistry:
    return create_dataset_registry(
        Dataset(
            name="orders",
            source="private_orders",
            tenant_key="private_tenant",
            dimensions={"country": dimension("string", column="private_country")},
            measures={"total": measure(count("private_id"))},
        )
    )


def test_discovery_and_documentation_are_closed_by_default() -> None:
    router = create_router(authenticate=authenticate)
    add_discovery_endpoint(router, registry=registry())
    client = TestClient(create_app(router, security=HttpSecurity(allowed_hosts=("testserver",))))
    assert client.get("/discovery").status_code == 401
    response = client.get("/discovery", headers={"Authorization": "Bearer reader"})
    assert response.status_code == 200
    for marker in ("private_", "tenantKey", "requiresTenant", "source", "column", "sql"):
        assert marker not in response.text
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_public_discovery_and_development_docs_require_explicit_opt_in() -> None:
    router = create_router(authenticate=authenticate)
    add_discovery_endpoint(router, registry=registry(), policy=EndpointPolicy(public=True))
    client = TestClient(
        create_app(
            router, security=HttpSecurity(allowed_hosts=("testserver",)), development_docs=True
        )
    )
    assert client.get("/discovery").status_code == 200
    assert client.get("/openapi.json").json()["paths"]["/discovery"]


def test_discovery_budget_and_policy_fail_at_startup() -> None:
    router = create_router(authenticate=authenticate)
    with pytest.raises(ValueError, match="byte budget"):
        add_discovery_endpoint(router, registry=registry(), max_bytes=1)
    with pytest.raises(ValueError, match="public"):
        EndpointPolicy(public=True, required_scopes=frozenset({"admin"}))


def test_discovery_enforces_roles() -> None:
    router = create_router(authenticate=authenticate)
    add_discovery_endpoint(
        router, registry=registry(), policy=EndpointPolicy(required_roles=frozenset({"admin"}))
    )
    client = TestClient(create_app(router, security=HttpSecurity(allowed_hosts=("testserver",))))
    assert client.get("/discovery", headers={"Authorization": "Bearer reader"}).status_code == 403

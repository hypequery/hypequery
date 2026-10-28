"""Discovery projection, endpoint policy, and application documentation policy."""

from __future__ import annotations

import pytest

from asgi_client import AsgiClient
from hypequery.datasets import (
    Dataset,
    DatasetRegistry,
    create_dataset_registry,
    dimension,
    measure,
)
from hypequery.datasets.aggregations import (
    count,
)
from hypequery.serve import (
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_discovery_endpoint,
    create_api,
    to_asgi_app,
)

SECURITY = HttpSecurity(allowed_hosts=("testserver",))


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
    api = create_api(auth=authenticate, security=SECURITY)
    add_discovery_endpoint(api, registry=registry())
    client = AsgiClient(to_asgi_app(api))
    assert client.get("/discovery").status_code == 401
    response = client.get("/discovery", headers={"Authorization": "Bearer reader"})
    assert response.status_code == 200
    for marker in ("private_", "tenantKey", "requiresTenant", "source", "column", "sql"):
        assert marker not in response.text
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404
        assert client.get(path).json()["error"]["type"] == "NOT_FOUND"


def test_public_discovery_and_development_docs_require_explicit_opt_in() -> None:
    api = create_api(auth=authenticate, security=SECURITY, development_docs=True)
    add_discovery_endpoint(api, registry=registry(), policy=EndpointPolicy(public=True))
    client = AsgiClient(to_asgi_app(api))
    assert client.get("/discovery").status_code == 200
    document = client.get("/openapi.json").json()
    assert "security" not in document["paths"]["/discovery"]["get"]
    docs = client.get("/docs")
    assert docs.headers["content-type"] == "text/html; charset=utf-8"
    assert 'spec-url="openapi.json"' in docs.text


def test_discovery_budget_and_policy_fail_at_startup() -> None:
    api = create_api(auth=authenticate)
    with pytest.raises(ValueError, match="byte budget"):
        add_discovery_endpoint(api, registry=registry(), max_bytes=1)
    with pytest.raises(ValueError, match="public"):
        EndpointPolicy(public=True, required_scopes=frozenset({"admin"}))


def test_discovery_enforces_roles() -> None:
    api = create_api(auth=authenticate, security=SECURITY)
    add_discovery_endpoint(
        api, registry=registry(), policy=EndpointPolicy(required_roles=frozenset({"admin"}))
    )
    client = AsgiClient(to_asgi_app(api))
    assert client.get("/discovery", headers={"Authorization": "Bearer reader"}).status_code == 403


@pytest.mark.parametrize(
    ("roles", "scopes", "status"),
    [
        (frozenset({"admin"}), frozenset({"catalog:read", "data:read"}), 200),
        (frozenset({"editor"}), frozenset({"catalog:read", "data:read"}), 200),
        (frozenset(), frozenset({"catalog:read", "data:read"}), 403),
        (frozenset({"reader"}), frozenset({"catalog:read", "data:read"}), 403),
        (frozenset({"admin"}), frozenset({"catalog:read"}), 403),
    ],
)
def test_discovery_accepts_any_required_role_but_requires_all_scopes(
    roles: frozenset[str], scopes: frozenset[str], status: int
) -> None:
    api = create_api(
        auth=lambda credential: Principal(subject="alice", roles=roles, scopes=scopes),
        security=SECURITY,
    )
    add_discovery_endpoint(
        api,
        registry=registry(),
        policy=EndpointPolicy(
            required_roles=frozenset({"admin", "editor"}),
            required_scopes=frozenset({"catalog:read", "data:read"}),
        ),
    )
    client = AsgiClient(to_asgi_app(api))
    response = client.get("/discovery", headers={"Authorization": "Bearer reader"})
    assert response.status_code == status

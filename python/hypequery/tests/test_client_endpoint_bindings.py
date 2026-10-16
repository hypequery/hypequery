"""Installed routes share SDK descriptors, strict validation and schema preconditions."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hypequery.datasets import (
    ClientQueryProfile,
    CompiledQuery,
    Dataset,
    DatasetLimits,
    create_dataset_client,
    dimension,
    measure,
)
from hypequery.datasets.planner import query_settings
from hypequery.protocol import ProtocolClientContractError
from hypequery.serve import (
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    ProductionProfile,
    add_dataset_endpoint,
    add_metric_endpoint,
    create_api,
    create_app,
    create_dataset_endpoint,
    export_client_contract,
)


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...] = ("total",)
    rows: tuple[tuple[str | int, ...], ...] = ((12,),)


@dataclass
class Executor:
    seen: list[CompiledQuery] = field(default_factory=list)

    def execute(self, query: CompiledQuery) -> Rows:
        self.seen.append(query)
        return Rows()


def authenticate(credential: Credential) -> Principal | None:
    if credential.value == "reader":
        return Principal(subject="reader", scopes=frozenset({"read"}))
    if credential.value == "viewer":
        return Principal(subject="viewer")
    return None


def setup(*, production: ProductionProfile | None = None) -> tuple[FastAPI, Executor]:
    dataset = Dataset(
        name="orders",
        source="private_orders",
        dimensions={"country": dimension.string()},
        measures={"total": measure.count("country")},
        limits=DatasetLimits(max_result_size=9),
    )
    executor = Executor()
    client = create_dataset_client(executor=executor, settings=query_settings(max_result_rows=8))
    router = create_api(authenticate=authenticate, prefix="/api")
    add_dataset_endpoint(
        router,
        "/orders",
        dataset=dataset,
        client=client,
        policy=EndpointPolicy(max_limit=6, required_scopes=frozenset({"read"})),
        client_profile=ClientQueryProfile(default_limit=3, max_limit=10),
    )
    return create_app(
        router, security=HttpSecurity(allowed_hosts=("testserver",)), production=production
    ), executor


def test_registered_export_matches_runtime_limits_and_strict_requests() -> None:
    app, executor = setup(production=ProductionProfile(max_result_rows=5))
    artifact = export_client_contract(app)
    endpoint = artifact["contract"]["endpoints"][0]
    assert endpoint["path"] == "/api/orders"
    assert endpoint["limits"]["maxLimit"] == 4
    assert endpoint["limits"]["defaultLimit"] == 3
    headers = {
        "Authorization": "Bearer reader",
        "X-Hypequery-Client-Schema": endpoint["schemaHash"],
    }
    with TestClient(app) as http:
        result = http.post("/api/orders", json={"limit": 100, "includeMeta": True}, headers=headers)
    assert result.status_code == 200
    assert result.json()["meta"]["pagination"]["limit"] == 4
    assert "LIMIT 5" in executor.seen[0].sql


def test_auth_and_policy_precede_stale_schema_and_execution() -> None:
    app, executor = setup()
    with TestClient(app) as http:
        for token, status in [(None, 401), ("viewer", 403), ("reader", 409)]:
            headers = {"X-Hypequery-Client-Schema": "stale"}
            if token:
                headers["Authorization"] = "Bearer " + token
            response = http.post("/api/orders", json={}, headers=headers)
            assert response.status_code == status
        assert response.json()["error"]["details"] == {"code": "CLIENT_SCHEMA_CHANGED"}
    assert executor.seen == []


@pytest.mark.parametrize(
    "payload",
    [
        {"filters": None},
        {"limit": True},
        {"timezone": "UTC"},
        {"orderBy": [{"field": "country", "direction": "asc"}]},
        {"tenant": "secret"},
        {"segments": []},
        {"sql": "secret"},
    ],
)
def test_strict_input_rejected_before_planning(payload: dict[str, object]) -> None:
    app, executor = setup()
    with TestClient(app) as http:
        result = http.post("/api/orders", json=payload, headers={"Authorization": "Bearer reader"})
    assert result.status_code == 400
    assert result.json()["error"]["message"] == "Invalid client query."
    assert executor.seen == []


def test_metric_alias_and_custom_app_inclusion_prefix() -> None:
    dataset = Dataset(
        name="orders",
        source="private_orders",
        dimensions={"country": dimension.string()},
        measures={"total": measure.count("country")},
    )
    router = create_api(authenticate=authenticate, prefix="/api")
    add_metric_endpoint(
        router,
        "/sales",
        dataset=dataset,
        client=create_dataset_client(executor=Executor()),
        measure="total",
        name="sales",
        client_profile=ClientQueryProfile(),
    )
    app = FastAPI()
    app.include_router(router, prefix="/v2")
    artifact = export_client_contract(app, routers=[router])
    endpoint = artifact["contract"]["endpoints"][0]
    assert endpoint["path"] == "/v2/api/sales"
    assert list(endpoint["measures"]) == ["sales"]
    with TestClient(app) as http:
        response = http.post(
            "/v2/api/sales",
            json={},
            headers={
                "Authorization": "Bearer reader",
                "X-Hypequery-Client-Schema": endpoint["schemaHash"],
            },
        )
    assert response.status_code == 200
    assert response.json()["data"][0]["sales"] == "12"


def test_legacy_endpoints_are_not_advertised() -> None:
    router = create_api(authenticate=authenticate)
    dataset = Dataset(
        name="orders", source="private_orders", dimensions={"country": dimension.string()}
    )
    add_dataset_endpoint(
        router, "/legacy", dataset=dataset, client=create_dataset_client(executor=Executor())
    )
    app = create_app(router, security=HttpSecurity(allowed_hosts=("testserver",)))
    assert export_client_contract(app)["contract"]["endpoints"] == []


def test_duplicate_opt_in_install_fails_before_adding_route() -> None:
    router = create_api(authenticate=authenticate)
    dataset = Dataset(name="orders", source="private", dimensions={"country": dimension.string()})
    endpoint = create_dataset_endpoint(
        dataset=dataset,
        client=create_dataset_client(executor=Executor()),
        client_profile=ClientQueryProfile(),
    )
    endpoint.install(router, "/one")
    with pytest.raises(ValueError, match="unique"):
        endpoint.install(router, "/two")
    assert len(router.routes) == 1


def test_installation_snapshots_endpoint_and_mount_configuration() -> None:
    dataset = Dataset(
        name="orders",
        source="private_orders",
        dimensions={"country": dimension.string()},
        measures={"total": measure.count("country")},
    )
    router = create_api(authenticate=authenticate, prefix="/api")
    executor = Executor()
    endpoint = create_dataset_endpoint(
        dataset=dataset,
        client=create_dataset_client(executor=executor),
        client_profile=ClientQueryProfile(),
    )
    endpoint.install(router, "/orders")
    endpoint.dataset = Dataset(name="changed", source="wrong", dimensions={"x": dimension.string()})
    app = create_app(
        router, security=HttpSecurity(allowed_hosts=("testserver",)), client_mount_path="/edge"
    )
    descriptor = export_client_contract(app)["contract"]["endpoints"][0]
    assert descriptor["path"] == "/edge/api/orders"
    with TestClient(app) as http:
        response = http.post(
            "/api/orders",
            json={},
            headers={
                "Authorization": "Bearer reader",
                "X-Hypequery-Client-Schema": descriptor["schemaHash"],
            },
        )
    assert response.status_code == 200
    assert "private_orders" in executor.seen[0].sql
    assert "wrong" not in executor.seen[0].sql
    with pytest.raises(ValueError, match="mount path"):
        export_client_contract(app, mount_path="/other")


def test_ambiguous_application_inclusions_are_refused() -> None:
    router = create_api(authenticate=authenticate)
    dataset = Dataset(name="orders", source="private", dimensions={"country": dimension.string()})
    add_dataset_endpoint(
        router,
        "/orders",
        dataset=dataset,
        client=create_dataset_client(executor=Executor()),
        client_profile=ClientQueryProfile(),
    )
    app = FastAPI()
    app.include_router(router, prefix="/one")
    app.include_router(router, prefix="/two")
    with pytest.raises(ProtocolClientContractError) as failure:
        export_client_contract(app, routers=[router])
    assert failure.value.code == "HQ_CLIENT_DUPLICATE"


def test_metric_override_and_integer_valued_json_limits() -> None:
    app, executor = setup()
    with TestClient(app) as http:
        response = http.post(
            "/api/orders", json={"limit": 1.0}, headers={"Authorization": "Bearer reader"}
        )
    assert response.status_code == 200
    assert "LIMIT 2" in executor.seen[0].sql


def test_async_endpoints_use_the_same_contract_and_profile() -> None:
    from hypequery.datasets import create_async_dataset_client

    class AsyncExecutor:
        async def execute(self, compiled: CompiledQuery) -> Rows:
            return Rows()

    dataset = Dataset(
        name="orders",
        source="private",
        dimensions={"country": dimension.string()},
        measures={"total": measure.count("country")},
    )
    router = create_api(authenticate=authenticate)
    add_dataset_endpoint(
        router,
        "/orders",
        dataset=dataset,
        client=create_async_dataset_client(executor=AsyncExecutor()),
        client_profile=ClientQueryProfile(),
    )
    app = create_app(router, security=HttpSecurity(allowed_hosts=("testserver",)))
    descriptor = export_client_contract(app)["contract"]["endpoints"][0]
    with TestClient(app) as http:
        response = http.post(
            "/orders",
            json={},
            headers={
                "Authorization": "Bearer reader",
                "X-Hypequery-Client-Schema": descriptor["schemaHash"],
            },
        )
    assert response.status_code == 200
    assert response.json()["data"] == [{"total": "12"}]


def test_schema_pin_header_is_allowed_through_configured_cors() -> None:
    from hypequery.serve import CorsPolicy

    router = create_api(authenticate=authenticate)
    dataset = Dataset(name="orders", source="private", dimensions={"country": dimension.string()})
    add_dataset_endpoint(
        router,
        "/orders",
        dataset=dataset,
        client=create_dataset_client(executor=Executor()),
        client_profile=ClientQueryProfile(),
    )
    app = create_app(
        router,
        security=HttpSecurity(
            allowed_hosts=("testserver",), cors=CorsPolicy(origins=("https://frontend.example",))
        ),
    )
    with TestClient(app) as http:
        response = http.options(
            "/orders",
            headers={
                "Origin": "https://frontend.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": (
                    "authorization,x-hypequery-client-schema,content-type"
                ),
            },
        )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://frontend.example"


def test_matching_schema_pin_still_enforces_current_lower_limits() -> None:
    old, _ = setup()
    pinned = export_client_contract(old)["contract"]["endpoints"][0]
    current, _ = setup(production=ProductionProfile(max_result_rows=3))
    with TestClient(current) as http:
        response = http.post(
            "/api/orders",
            json={"limit": 100, "includeMeta": True},
            headers={
                "Authorization": "Bearer reader",
                "X-Hypequery-Client-Schema": pinned["schemaHash"],
            },
        )
    assert response.status_code == 200
    assert response.json()["meta"]["pagination"]["limit"] == 2


@pytest.mark.parametrize("kind", ["starlette", "catchall", "mount"])
def test_custom_host_routes_cannot_shadow_a_client_endpoint(kind: str) -> None:
    from starlette.responses import JSONResponse
    from starlette.routing import Mount, Route

    router = create_api(authenticate=authenticate)
    dataset = Dataset(name="orders", source="private", dimensions={"country": dimension.string()})
    add_dataset_endpoint(
        router,
        "/orders",
        dataset=dataset,
        client=create_dataset_client(executor=Executor()),
        client_profile=ClientQueryProfile(),
    )
    app = FastAPI()
    if kind == "starlette":
        app.router.routes.append(
            Route("/orders", lambda request: JSONResponse({}), methods=["POST"])
        )
    elif kind == "catchall":
        app.post("/{path:path}")(lambda path: {})
    else:
        app.router.routes.append(Mount("/orders", app=FastAPI()))
    app.include_router(router)
    with pytest.raises(ValueError, match="ambiguous"):
        export_client_contract(app, routers=[router])

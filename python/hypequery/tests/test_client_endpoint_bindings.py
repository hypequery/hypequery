"""Installed routes share SDK descriptors, strict validation and schema preconditions."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from asgi_client import AsgiClient
from hypequery.datasets import (
    ClientQueryProfile,
    CompiledQuery,
    Dataset,
    DatasetLimits,
    belongs_to,
    create_dataset_client,
    create_dataset_registry,
    dimension,
    measure,
)
from hypequery.datasets.planner import query_settings
from hypequery.serve import (
    AsgiApp,
    Call,
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    ProductionProfile,
    ServeResponse,
    add_dataset_endpoint,
    add_metric_endpoint,
    create_api,
    create_dataset_endpoint,
    export_client_contract,
    to_asgi_app,
)

SECURITY = HttpSecurity(allowed_hosts=("testserver",))


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


def setup(*, production: ProductionProfile | None = None) -> tuple[AsgiApp, Executor]:
    dataset = Dataset(
        name="orders",
        source="private_orders",
        dimensions={"country": dimension.string()},
        measures={"total": measure.count("country")},
        limits=DatasetLimits(max_result_size=9),
    )
    executor = Executor()
    client = create_dataset_client(executor=executor, settings=query_settings(max_result_rows=8))
    api = create_api(auth=authenticate, base_path="/api", security=SECURITY, production=production)
    add_dataset_endpoint(
        api,
        "/orders",
        dataset=dataset,
        client=client,
        policy=EndpointPolicy(max_limit=6, required_scopes=frozenset({"read"})),
        client_profile=ClientQueryProfile(default_limit=3, max_limit=10),
    )
    return to_asgi_app(api), executor


def test_registered_export_matches_runtime_limits_and_strict_requests() -> None:
    app, executor = setup(production=ProductionProfile(max_result_rows=5))
    artifact = export_client_contract(app.api)
    endpoint = artifact["contract"]["endpoints"][0]
    assert endpoint["path"] == "/api/orders"
    assert endpoint["limits"]["maxLimit"] == 4
    assert endpoint["limits"]["defaultLimit"] == 3
    headers = {
        "Authorization": "Bearer reader",
        "X-Hypequery-Client-Schema": endpoint["schemaHash"],
    }
    with AsgiClient(app) as http:
        result = http.post("/api/orders", json={"limit": 100, "includeMeta": True}, headers=headers)
    assert result.status_code == 200
    assert result.json()["meta"]["pagination"]["limit"] == 4
    assert "LIMIT 5" in executor.seen[0].sql


def test_auth_and_policy_precede_stale_schema_and_execution() -> None:
    app, executor = setup()
    with AsgiClient(app) as http:
        for token, status in [(None, 401), ("viewer", 403), ("reader", 409)]:
            headers = {"X-Hypequery-Client-Schema": "stale"}
            if token:
                headers["Authorization"] = "Bearer " + token
            response = http.post("/api/orders", json={}, headers=headers)
            assert response.status_code == status
        assert response.json()["error"]["details"] == {"code": "CLIENT_SCHEMA_CHANGED"}
    assert executor.seen == []


@pytest.mark.parametrize(
    ("payload", "path"),
    [
        ({"filters": None}, ["filters"]),
        ({"limit": True}, ["limit"]),
        ({"timezone": "UTC"}, []),
        ({"orderBy": [{"field": "country", "direction": "asc"}]}, ["orderBy", 0, "field"]),
        ({"tenant": "secret"}, []),
        ({"segments": []}, []),
        ({"sql": "secret"}, []),
    ],
)
def test_strict_input_rejected_before_planning(
    payload: dict[str, object], path: list[object]
) -> None:
    app, executor = setup()
    with AsgiClient(app) as http:
        result = http.post("/api/orders", json=payload, headers={"Authorization": "Bearer reader"})
    assert result.status_code == 400
    error = result.json()["error"]
    assert error["message"] == "Invalid client query."
    # Where it failed, never what was sent: an unknown member is reported at the root.
    assert error["details"] == {
        "issues": [{"path": path, "message": "Invalid client query.", "code": "HQ_CLIENT_QUERY"}]
    }
    assert "secret" not in result.text
    assert executor.seen == []


def test_metric_alias_under_the_base_path() -> None:
    dataset = Dataset(
        name="orders",
        source="private_orders",
        dimensions={"country": dimension.string()},
        measures={"total": measure.count("country")},
    )
    api = create_api(auth=authenticate, base_path="/v2/api")
    add_metric_endpoint(
        api,
        "/sales",
        dataset=dataset,
        client=create_dataset_client(executor=Executor()),
        measure="total",
        name="sales",
        client_profile=ClientQueryProfile(),
    )
    artifact = export_client_contract(api)
    endpoint = artifact["contract"]["endpoints"][0]
    assert endpoint["path"] == "/v2/api/sales"
    assert list(endpoint["measures"]) == ["sales"]
    with AsgiClient(to_asgi_app(api)) as http:
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


def test_separate_clients_keep_their_own_relationship_targets() -> None:
    router = create_api(auth=authenticate)
    for name, attribute in (("orders", "tier"), ("invoices", "region")):
        customers = Dataset(
            name="customers",
            source=f"{name}_customers",
            dimensions={"id": dimension.number(), attribute: dimension.string()},
        )
        dataset = Dataset(
            name=name,
            source=name,
            dimensions={"id": dimension.number()},
            measures={"total": measure.count("id")},
            relationships={"customer": belongs_to(customers, from_field="id", to_field="id")},
        )
        client = create_dataset_client(
            executor=Executor(), registry=create_dataset_registry(dataset, customers)
        )
        add_dataset_endpoint(
            router,
            f"/{name}",
            dataset=dataset,
            client=client,
            client_profile=ClientQueryProfile(),
            include_related={"customer"},
        )
    endpoints = {
        item["id"]: item for item in export_client_contract(router)["contract"]["endpoints"]
    }
    assert "customer.tier" in endpoints["orders"]["dimensions"]
    assert "customer.region" not in endpoints["orders"]["dimensions"]
    assert "customer.region" in endpoints["invoices"]["dimensions"]
    assert "customer.tier" not in endpoints["invoices"]["dimensions"]


def test_legacy_endpoints_are_not_advertised() -> None:
    router = create_api(auth=authenticate, security=SECURITY)
    dataset = Dataset(
        name="orders", source="private_orders", dimensions={"country": dimension.string()}
    )
    add_dataset_endpoint(
        router, "/legacy", dataset=dataset, client=create_dataset_client(executor=Executor())
    )
    assert export_client_contract(router)["contract"]["endpoints"] == []


def test_duplicate_opt_in_install_fails_before_adding_route() -> None:
    router = create_api(auth=authenticate, security=SECURITY)
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
    router = create_api(
        auth=authenticate, base_path="/api", security=SECURITY, client_mount_path="/edge"
    )
    executor = Executor()
    endpoint = create_dataset_endpoint(
        dataset=dataset,
        client=create_dataset_client(executor=executor),
        client_profile=ClientQueryProfile(),
    )
    endpoint.install(router, "/orders")
    endpoint.dataset = Dataset(name="changed", source="wrong", dimensions={"x": dimension.string()})
    descriptor = export_client_contract(router)["contract"]["endpoints"][0]
    assert descriptor["path"] == "/edge/api/orders"
    with AsgiClient(to_asgi_app(router)) as http:
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
        export_client_contract(router, mount_path="/other")
    with pytest.raises(ValueError, match="production profile"):
        export_client_contract(router, production=ProductionProfile())


def test_metric_override_and_integer_valued_json_limits() -> None:
    app, executor = setup()
    with AsgiClient(app) as http:
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
    router = create_api(auth=authenticate, security=SECURITY)
    add_dataset_endpoint(
        router,
        "/orders",
        dataset=dataset,
        client=create_async_dataset_client(executor=AsyncExecutor()),
        client_profile=ClientQueryProfile(),
    )
    descriptor = export_client_contract(router)["contract"]["endpoints"][0]
    with AsgiClient(to_asgi_app(router)) as http:
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

    router = create_api(
        auth=authenticate,
        security=HttpSecurity(
            allowed_hosts=("testserver",), cors=CorsPolicy(origins=("https://frontend.example",))
        ),
    )
    dataset = Dataset(name="orders", source="private", dimensions={"country": dimension.string()})
    add_dataset_endpoint(
        router,
        "/orders",
        dataset=dataset,
        client=create_dataset_client(executor=Executor()),
        client_profile=ClientQueryProfile(),
    )
    with AsgiClient(to_asgi_app(router)) as http:
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
    pinned = export_client_contract(old.api)["contract"]["endpoints"][0]
    current, _ = setup(production=ProductionProfile(max_result_rows=3))
    with AsgiClient(current) as http:
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


def test_routes_cannot_shadow_a_client_endpoint() -> None:
    async def other(call: Call) -> ServeResponse:
        return ServeResponse.json({})

    dataset = Dataset(
        name="orders",
        source="private",
        dimensions={"country": dimension.string()},
        measures={"total": measure.count("country")},
    )
    client = create_dataset_client(executor=Executor())
    # A route already serving the path is refused...
    taken = create_api(auth=authenticate)
    taken.add_route("POST", "/orders", other)
    with pytest.raises(ValueError, match="already registered"):
        add_dataset_endpoint(
            taken, "/orders", dataset=dataset, client=client, client_profile=ClientQueryProfile()
        )
    # ...and one added later never serves it: the first route for a path does.
    api = create_api(auth=authenticate, security=SECURITY)
    add_dataset_endpoint(
        api, "/orders", dataset=dataset, client=client, client_profile=ClientQueryProfile()
    )
    api.add_route("POST", "/orders", other)
    descriptor = export_client_contract(api)["contract"]["endpoints"][0]
    with AsgiClient(to_asgi_app(api)) as http:
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

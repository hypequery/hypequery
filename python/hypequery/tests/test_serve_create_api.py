"""`create_api`: declared datasets, metrics and discovery, and the development docs."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest
from pydantic import BaseModel, TypeAdapter

from asgi_client import AsgiClient
from hypequery.datasets import (
    CompiledQuery,
    Dataset,
    create_dataset_client,
    create_dataset_registry,
    dimension,
    measure,
)
from hypequery.protocol import ProtocolIdentifierError
from hypequery.serve import (
    Api,
    Call,
    Credential,
    EndpointPolicy,
    HttpSecurity,
    OpenApiInfo,
    Principal,
    QueryEvents,
    RateLimit,
    ServeResponse,
    add_dataset_endpoint,
    add_discovery_endpoint,
    api_key,
    create_api,
    create_dataset_endpoint,
    create_metric_endpoint,
    openapi_document,
    to_asgi_app,
)

AUTH = {"Authorization": "Bearer reader"}


def _authenticate(credential: Credential) -> Principal | None:
    return Principal(subject="reader") if credential.value == "reader" else None


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...] = ("total",)
    rows: tuple[tuple[int, ...], ...] = ((7,),)


@dataclass
class Executor:
    seen: list[CompiledQuery] = field(default_factory=list)

    def execute(self, compiled: CompiledQuery) -> Rows:
        self.seen.append(compiled)
        return Rows()


def _orders(name: str = "orders") -> Dataset:
    return Dataset(
        name=name,
        source=f"private_{name}",
        dimensions={"country": dimension.string()},
        measures={"total": measure.count("country")},
    )


def _client(api: Api) -> AsgiClient:
    return AsgiClient(to_asgi_app(api))


# --- declared endpoints ---------------------------------------------------


def test_datasets_and_metrics_are_served_at_their_typescript_paths() -> None:
    executor = Executor()
    client = create_dataset_client(executor=executor)
    orders, invoices = _orders(), _orders("invoices")
    api = create_api(
        auth=_authenticate,
        client=client,
        base_path="/analytics",
        datasets={
            "orders": orders,
            "bills": create_dataset_endpoint(
                dataset=invoices, client=client, policy=EndpointPolicy(public=True)
            ),
        },
        metrics={
            "orderCount": create_metric_endpoint(dataset=orders, measure="total", client=client)
        },
    )
    http = _client(api)
    query = {"measures": ["total"]}
    assert http.post("/analytics/datasets/orders/query", json=query).status_code == 401
    assert http.post("/analytics/datasets/orders/query", json=query, headers=AUTH).json() == {
        "data": [{"total": "7"}]
    }
    assert http.post("/analytics/datasets/bills/query", json=query).status_code == 200
    metric = http.post("/analytics/metrics/orderCount", json={}, headers=AUTH)
    assert metric.json() == {"data": [{"total": "7"}]}
    assert http.get("/analytics/discovery").status_code == 401
    discovery = http.get("/analytics/discovery", headers=AUTH).json()
    assert [entry["name"] for entry in discovery["datasets"]] == ["invoices", "orders"]
    assert "private_" not in str(discovery)


def test_discovery_follows_its_policy_or_is_left_out() -> None:
    client = create_dataset_client(executor=Executor())
    public = create_api(
        auth=_authenticate,
        client=client,
        datasets={"orders": _orders()},
        discovery=EndpointPolicy(public=True),
    )
    assert _client(public).get("/discovery").status_code == 200
    closed = create_api(
        auth=_authenticate, client=client, datasets={"orders": _orders()}, discovery=False
    )
    assert _client(closed).get("/discovery", headers=AUTH).status_code == 404
    # Without declared endpoints there is nothing to discover.
    assert _client(create_api(auth=_authenticate)).get("/discovery").status_code == 404


@pytest.mark.parametrize(
    ("options", "error", "match"),
    [
        ({"datasets": {"orders": _orders()}}, ValueError, "client"),
        ({"datasets": {"orders": "orders"}}, TypeError, "datasets entry"),
        ({"metrics": {"total": _orders()}}, TypeError, "create_metric_endpoint"),
        ({"datasets": {"not a name": _orders()}, "client": True}, ProtocolIdentifierError, None),
        ({"datasets": {"orders": _orders()}, "client": True, "discovery": "yes"}, TypeError, None),
        ({"events": object()}, TypeError, "events"),
        ({"development_docs": "yes"}, TypeError, "development_docs"),
        ({"limits": [object()]}, TypeError, "limits"),
    ],
)
def test_declared_endpoints_are_checked(
    options: dict[str, Any], error: type[Exception], match: str | None
) -> None:
    if options.get("client") is True:
        options["client"] = create_dataset_client(executor=Executor())
    with pytest.raises(error, match=match):
        create_api(auth=_authenticate, **options)


def test_a_metric_is_not_a_dataset_entry() -> None:
    client = create_dataset_client(executor=Executor())
    metric = create_metric_endpoint(dataset=_orders(), measure="total", client=client)
    with pytest.raises(TypeError, match="datasets entry"):
        create_api(auth=_authenticate, datasets={"orders": metric})
    with pytest.raises(TypeError, match="installed on an Api"):
        metric.install(object(), "/x")  # type: ignore[arg-type]


def test_api_events_report_for_endpoints_without_their_own() -> None:
    target = {"project": "sdk", "environment": "test"}
    shared: list[dict[str, object]] = []
    own: list[dict[str, object]] = []
    client = create_dataset_client(executor=Executor())
    api = create_api(auth=_authenticate, events=QueryEvents(target=target, sink=shared.append))
    add_dataset_endpoint(api, "/shared", dataset=_orders(), client=client)
    add_dataset_endpoint(
        api,
        "/own",
        dataset=_orders(),
        client=client,
        events=QueryEvents(target=target, sink=own.append),
    )
    http = _client(api)
    for path in ("/shared", "/own"):
        assert http.post(path, json={"measures": ["total"]}, headers=AUTH).status_code == 200
    assert [event["queryName"] for event in shared] == ["orders"]
    assert [event["queryName"] for event in own] == ["orders"]


def test_api_limits_apply_to_every_route_before_its_own() -> None:
    async def ok(call: Call) -> ServeResponse:
        return ServeResponse.json({"ok": True})

    api = create_api(auth=_authenticate, limits=[RateLimit(max=2, window_seconds=60)])
    api.add_route("GET", "/a", ok, public=True)
    add_dataset_endpoint(
        api,
        "/query",
        dataset=_orders(),
        client=create_dataset_client(executor=Executor()),
        limits=[RateLimit(max=1, window_seconds=60)],
    )
    http = _client(api)
    assert [http.get("/a").status_code for _ in range(3)] == [200, 200, 429]
    query = {"measures": ["total"]}
    assert http.post("/query", json=query, headers=AUTH).status_code == 200
    assert http.post("/query", json=query, headers=AUTH).status_code == 429


# --- development OpenAPI and docs -----------------------------------------


class Echo(BaseModel):
    value: int


def _documented(**options: Any) -> Api:
    async def echo(call: Call) -> ServeResponse:
        return ServeResponse.json({})

    api = create_api(auth=_authenticate, development_docs=True, **options)
    api.add_route("POST", "/echo", echo, input=TypeAdapter(Echo), summary="Echo a value")
    api.add_route("GET", "/health", echo, public=True, tags=("ops",))
    model = _orders()
    add_dataset_endpoint(
        api, "/orders", dataset=model, client=create_dataset_client(executor=Executor())
    )
    add_discovery_endpoint(api, registry=create_dataset_registry(model))
    return api


def test_the_document_describes_every_route_from_its_schemas() -> None:
    document = _client(_documented()).get("/openapi.json").json()
    assert document["openapi"] == "3.1.0"
    assert document["info"] == {"title": "hypequery API", "version": "1.0.0"}
    paths = document["paths"]
    assert set(paths) == {"/echo", "/health", "/orders", "/discovery"}
    echo = paths["/echo"]["post"]
    assert echo["summary"] == "Echo a value"
    assert echo["operationId"] == "echo_echo_post"
    assert echo["requestBody"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/Echo"
    }
    assert echo["security"] == [{"credential": []}]
    health = paths["/health"]["get"]
    assert "security" not in health
    assert health["tags"] == ["ops"]
    assert health["summary"] == "Echo"
    orders = paths["/orders"]["post"]
    assert orders["tags"] == ["datasets"]
    assert orders["summary"] == "Dataset Query"
    success = orders["responses"]["200"]["content"]["application/json"]["schema"]
    assert {"$ref": "#/components/schemas/QueryResponse"} in success["anyOf"]
    assert orders["responses"]["default"]["content"]["application/json"]["schema"]["required"] == [
        "error"
    ]
    assert paths["/discovery"]["get"]["tags"] == ["discovery"]
    components = document["components"]
    assert components["securitySchemes"] == {"credential": {"type": "http", "scheme": "bearer"}}
    assert components["schemas"]["QueryRequest"]["additionalProperties"] is False
    assert "servers" not in document


def test_the_document_follows_the_api_configuration() -> None:
    api = _documented(
        credentials=api_key(),
        client_mount_path="/edge",
        base_path="/v1",
        openapi=OpenApiInfo(title="Orders <API>", version="2.0.0", description="Sales"),
    )
    http = _client(api)
    document = http.get("/v1/openapi.json").json()
    assert document["info"] == {"title": "Orders <API>", "version": "2.0.0", "description": "Sales"}
    assert document["servers"] == [{"url": "/edge"}]
    assert document["components"]["securitySchemes"]["credential"] == {
        "type": "apiKey",
        "in": "header",
        "name": "x-api-key",
    }
    assert "/v1/echo" in document["paths"]
    docs = http.get("/v1/docs")
    assert docs.status_code == 200
    assert docs.headers["content-type"] == "text/html; charset=utf-8"
    assert "<title>Orders &lt;API&gt;</title>" in docs.text
    assert 'spec-url="openapi.json"' in docs.text


def test_the_document_includes_routes_added_later_and_omits_its_own() -> None:
    api = create_api(auth=_authenticate, development_docs=True)
    assert openapi_document(api)["paths"] == {}  # before any route

    async def late(call: Call) -> ServeResponse:
        return ServeResponse.json({})

    api.add_route("DELETE", "/late", late, documented=False)
    api.add_route("PUT", "/late", late)
    paths = openapi_document(api)["paths"]
    assert isinstance(paths, dict)
    assert list(paths) == ["/late"]
    assert list(_client(api).get("/openapi.json").json()["paths"]["/late"]) == ["put"]


def test_development_docs_are_closed_by_default() -> None:
    api = create_api(auth=_authenticate, security=HttpSecurity(allowed_hosts=("testserver",)))
    http = _client(api)
    for path in ("/docs", "/openapi.json"):
        assert http.get(path).status_code == 404


def test_openapi_info_is_validated() -> None:
    with pytest.raises(TypeError, match="title"):
        OpenApiInfo(title=1)  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="description"):
        OpenApiInfo(description=1)  # type: ignore[arg-type]

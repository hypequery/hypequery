"""Test-only application: the tutorial plus one slow, cancellable view."""

import json
import os

from examples.client_dashboard.api import install as install_tutorial
from examples.client_dashboard.definitions import orders, profile
from examples.utils.config import required_environment
from examples.utils.server import application
from gate_definitions import joined, profiles
from gate_error_routes import ErrorRoutes
from hypequery.datasets import ClientQueryProfile, DatasetClient, dataset, measure
from hypequery.serve import Api, AsgiApp, EndpointPolicy, Principal, add_dataset_endpoint

slow = dataset(
    "slow",
    source="client_slow",
    tenant_key="org_id",
    dimensions={},
    measures={"pause": measure.sum("pause")},
)


def install(api: Api, client: DatasetClient) -> None:
    install_tutorial(api, client)
    ErrorRoutes().install(api)
    add_dataset_endpoint(
        api,
        "/v1/joined",
        dataset=joined,
        client=client,
        policy=EndpointPolicy(tenant="required"),
        client_profile=profile,
        include_related={"profile"},
    )
    add_dataset_endpoint(
        api,
        "/v1/slow",
        dataset=slow,
        client=client,
        policy=EndpointPolicy(tenant="required"),
        client_profile=ClientQueryProfile(default_limit=1, max_limit=1),
    )


class FaultMiddleware:
    """A pure ASGI wrapper that injects one fault; the gate must detect it."""

    def __init__(self, app: AsgiApp, fault: str) -> None:
        self.app = app
        self.fault = fault

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if self.fault == "mcp" and scope["method"] == "POST":
            body = json.dumps({"error": {"type": "SERVICE_UNAVAILABLE"}}).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 503,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        target = "/v1/orders" if self.fault == "wire" else "/v1/joined"
        if scope["path"] != target:
            await self.app(scope, receive, send)
            return
        start: dict = {}
        chunks: list[bytes] = []

        async def capture(message) -> None:
            if message["type"] == "http.response.start":
                start.update(message)
            elif message["type"] == "http.response.body":
                chunks.append(message.get("body", b""))

        await self.app(scope, receive, capture)
        body = b"".join(chunks)
        headers = [(name, value) for name, value in start["headers"] if name != b"content-length"]
        if start["status"] == 200:
            value = json.loads(body)
            field = "revenue" if self.fault == "wire" else "profile.total"
            for row in value.get("data", []):
                if row.get(field) is not None:
                    row[field] = float(row[field])
            body = json.dumps(value).encode()
        headers.append((b"content-length", str(len(body)).encode()))
        await send({**start, "headers": headers})
        await send({"type": "http.response.body", "body": body})


def app():
    fault = os.environ.get("HYPEQUERY_GATE_FAULT")
    result = application(
        datasets=(orders, slow, joined, profiles),
        install=install,
        cors_origins=(
            "http://127.0.0.1:5999" if fault == "cors" else "http://127.0.0.1:5173",
        ),
        principals={
            required_environment("HYPEQUERY_TENANT_A_TOKEN"): Principal(
                subject="alice", tenant_id="a", scopes=frozenset({"analytics:read"})
            ),
            "gate-denied-user": Principal(subject="denied", tenant_id="a"),
            required_environment("HYPEQUERY_TENANT_B_TOKEN"): Principal(
                subject="bob",
                tenant_id="a" if fault == "tenant" else "b",
                scopes=frozenset({"analytics:read"}),
            ),
        },
    )
    if fault in {"mcp", "wire", "related-wire"}:
        return FaultMiddleware(result, fault)
    return result

"""Test-only application: the tutorial plus one slow, cancellable view."""

import json
import os

from examples.client_dashboard.api import install as install_tutorial
from examples.client_dashboard.definitions import orders, profile
from examples.utils.config import required_environment
from examples.utils.server import application
from fastapi import FastAPI, Request
from gate_definitions import joined, profiles
from hypequery.datasets import ClientQueryProfile, DatasetClient, dataset, measure
from hypequery.serve import EndpointPolicy, Principal, ServeRouter, add_dataset_endpoint
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse, Response

slow = dataset(
    "slow",
    source="client_slow",
    tenant_key="org_id",
    dimensions={},
    measures={"pause": measure.sum("pause")},
)


def install(api: ServeRouter, client: DatasetClient) -> None:
    install_tutorial(api, client)
    add_dataset_endpoint(
        api,
        "/v1/joined",
        dataset=joined,
        client=client,
        policy=EndpointPolicy(tenant="required"),
        client_profile=profile,
    )
    add_dataset_endpoint(
        api,
        "/v1/slow",
        dataset=slow,
        client=client,
        policy=EndpointPolicy(tenant="required"),
        client_profile=ClientQueryProfile(default_limit=1, max_limit=1),
    )


class FaultMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        fault = os.environ.get("HYPEQUERY_GATE_FAULT")
        if fault == "mcp" and request.method == "POST":
            return JSONResponse(
                {"error": {"type": "SERVICE_UNAVAILABLE"}}, status_code=503
            )
        response = await call_next(request)
        if (
            fault in {"wire", "related-wire"}
            and response.status_code == 200
            and request.url.path == ("/v1/orders" if fault == "wire" else "/v1/joined")
        ):
            body = b"".join([chunk async for chunk in response.body_iterator])
            value = json.loads(body)
            field = "revenue" if fault == "wire" else "profile.total"
            for row in value.get("data", []):
                if row.get(field) is not None:
                    row[field] = float(row[field])
            headers = dict(response.headers)
            headers.pop("content-length", None)
            return JSONResponse(value, headers=headers)
        return response


def app() -> FastAPI:
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
            required_environment("HYPEQUERY_TENANT_B_TOKEN"): Principal(
                subject="bob",
                tenant_id="a" if fault == "tenant" else "b",
                scopes=frozenset({"analytics:read"}),
            ),
        },
    )
    if fault in {"mcp", "wire", "related-wire"}:
        result.add_middleware(FaultMiddleware)
    return result

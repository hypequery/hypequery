"""Django's `urls(api)` and Flask's `blueprint(api)`: mounted below any prefix.

Both route on the framework's own URL map and hand the core the path below
their prefix, matched as sent. Client contracts, discovery and the OpenAPI
document name the paths the request was routed under, unless the API sets
`client_mount_path`.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Any

import pytest

pytest.importorskip("django")
pytest.importorskip("flask")

from hypequery.datasets import (
    ClientQueryProfile,
    CompiledQuery,
    Dataset,
    create_dataset_client,
    dimension,
    measure,
)
from hypequery.datasets.client import ResultScalar
from hypequery.serve import (
    Api,
    Call,
    Credential,
    Principal,
    ServeResponse,
    add_client_contract_endpoint,
    add_dataset_endpoint,
    create_api,
)
from hypequery.serve.utils.serving_loop import serving_loop
from serve_transports import ROUTED, serve_client

AUTH = {"authorization": "Bearer reader"}


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


class Executor:
    def execute(self, compiled: CompiledQuery) -> Rows:
        columns = tuple(re.findall(r" AS `([^`]+)`", compiled.sql))
        return Rows(columns, ((3,),) if columns == ("total",) else ())


def _authenticate(credential: Credential) -> Principal | None:
    return Principal(subject="reader") if credential.value == "reader" else None


def _api(**options: Any) -> Api:
    async def where(call: Call) -> ServeResponse:
        return ServeResponse.json(
            {
                "path": call.request.path,
                "mount": call.host.mount_path,
                "raw": type(call.request.raw).__name__,
                "loop": id(asyncio.get_running_loop()),
            }
        )

    api = create_api(auth=_authenticate, development_docs=True, **options)
    api.add_route("GET", "/where", where)
    api.add_route("GET", "/a b", where)
    dataset = Dataset(
        name="orders",
        source="orders",
        dimensions={"country": dimension.string()},
        measures={"total": measure.count("country")},
    )
    add_dataset_endpoint(
        api,
        "/orders",
        dataset=dataset,
        client=create_dataset_client(executor=Executor()),
        client_profile=ClientQueryProfile(),
    )
    add_client_contract_endpoint(api)
    return api


@pytest.mark.parametrize("transport", ROUTED)
@pytest.mark.parametrize(
    ("prefix", "url", "mount"),
    [
        ("", "/where", ""),
        ("/api/analytics", "/api/analytics/where", "/api/analytics"),
        # A prefix with its own URL variable: the mount is where this request went.
        ("/<org>/analytics", "/acme/analytics/where", "/acme/analytics"),
    ],
)
def test_the_api_is_served_below_any_prefix(
    transport: str, prefix: str, url: str, mount: str
) -> None:
    client = serve_client(transport, _api(), prefix=prefix)
    body = client.get(url, headers=AUTH).json()
    assert body["path"] == "/where"
    assert body["mount"] == mount
    contract = client.get(f"{mount}/client-contract", headers=AUTH).json()
    assert [endpoint["path"] for endpoint in contract["endpoints"]] == [f"{mount}/orders"]
    assert client.get(f"{mount}/openapi.json").json().get("servers") == (
        [{"url": mount}] if mount else None
    )


@pytest.mark.parametrize("transport", ROUTED)
def test_the_configured_client_mount_path_names_the_paths(transport: str) -> None:
    client = serve_client(transport, _api(client_mount_path="/public"), prefix="/internal")
    contract = client.get("/internal/client-contract", headers=AUTH).json()
    assert contract["endpoints"][0]["path"] == "/public/orders"


@pytest.mark.parametrize("transport", ROUTED)
def test_a_pinned_schema_is_the_one_served_under_the_prefix(transport: str) -> None:
    client = serve_client(transport, _api(), prefix="/api")
    contract = client.get("/api/client-contract", headers=AUTH).json()
    pinned = contract["endpoints"][0]["schemaHash"]
    query = {"measures": ["total"]}
    served = client.post(
        "/api/orders", json=query, headers={**AUTH, "x-hypequery-client-schema": pinned}
    )
    assert served.status_code == 200, served.text
    assert served.json()["data"] == [{"total": "3"}]
    root = serve_client("core", _api()).request("GET", "/client-contract", headers=AUTH)
    stale = root.json()["endpoints"][0]["schemaHash"]
    assert stale != pinned
    refused = client.post(
        "/api/orders", json=query, headers={**AUTH, "x-hypequery-client-schema": stale}
    )
    assert refused.status_code == 409


@pytest.mark.parametrize("transport", ROUTED)
def test_below_the_prefix_the_core_answers_and_matches_the_path_as_sent(transport: str) -> None:
    client = serve_client(transport, _api(), prefix="/api")
    missing = client.get("/api/nowhere", headers=AUTH)
    assert missing.status_code == 404
    assert missing.json()["error"]["message"] == "No endpoint registered for GET /nowhere"
    # The router decoded the path to find the prefix; the core sees it as sent.
    encoded = client.get("/%61pi/%77here", headers=AUTH)
    assert encoded.json()["error"]["message"] == "No endpoint registered for GET /%77here"
    spaced = client.get("/api/a%20b", headers=AUTH)
    assert spaced.json()["error"]["message"] == "No endpoint registered for GET /a%20b"


@pytest.mark.parametrize("transport", ["django-wsgi", "flask"])
def test_without_the_request_target_the_decoded_path_is_matched(transport: str) -> None:
    # A WSGI server that passes only PATH_INFO, as wsgiref does.
    client = serve_client(transport, _api(), prefix="/api", raw_uri=False)
    assert client.get("/api/a%20b", headers=AUTH).json()["path"] == "/a b"


@pytest.mark.parametrize("transport", ROUTED)
def test_outside_the_prefix_the_framework_answers(transport: str) -> None:
    response = serve_client(transport, _api(), prefix="/api").get("/where", headers=AUTH)
    assert response.status_code == 404
    assert "error" not in response.text


@pytest.mark.parametrize(
    ("transport", "raw"),
    [("django-wsgi", "WSGIRequest"), ("django-asgi", "ASGIRequest"), ("flask", "Request")],
)
def test_raw_is_the_framework_request(transport: str, raw: str) -> None:
    assert serve_client(transport, _api()).get("/where", headers=AUTH).json()["raw"] == raw


@pytest.mark.parametrize("transport", ["django-wsgi", "flask"])
def test_sync_views_run_the_core_on_the_process_serving_loop(transport: str) -> None:
    body = serve_client(transport, _api()).get("/where", headers=AUTH).json()
    assert body["loop"] == id(serving_loop().loop)


def test_async_django_views_run_the_core_on_the_server_loop() -> None:
    body = serve_client("django-asgi", _api()).get("/where", headers=AUTH).json()
    assert body["loop"] != id(serving_loop().loop)

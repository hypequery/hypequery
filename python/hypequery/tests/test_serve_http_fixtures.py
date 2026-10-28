"""Runs the language-neutral serve HTTP error fixtures (specs/serve-http).

Each case runs directly against the framework-neutral core's `Api.handle` and
through the pure-ASGI adapter, each with and without a production profile.

`@hypequery/serve` runs the same file in `serve-http-fixtures.test.ts`. A
divergence between the two is a bug in one of them or in the fixtures.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ConfigDict, TypeAdapter

from asgi_client import AsgiClient
from core_transport import CoreClient
from hypequery.serve import (
    Api,
    Call,
    Credential,
    HttpSecurity,
    Principal,
    ProductionProfile,
    RateLimit,
    ServeResponse,
    create_api,
    to_asgi_app,
)

FIXTURES = json.loads(
    (
        Path(__file__).resolve().parents[3] / "specs/serve-http/fixtures/errors-v1/cases.json"
    ).read_text(encoding="utf-8")
)
CREDENTIAL = FIXTURES["app"]["credential"]
TRANSPORTS = ["core", "core-production", "asgi", "asgi-production"]


class _FailingStore:
    async def hit(self, key: str, window_seconds: int) -> tuple[int, float]:
        raise RuntimeError("store offline")


class _Validated(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    limit: float


def _api(production: bool = False) -> Api:
    """The fixture app described in cases.json, fresh for each case."""

    def authenticate(credential: Credential) -> Principal | None:
        return Principal(subject="alice") if credential.value == CREDENTIAL else None

    async def ok(call: Call) -> ServeResponse:
        return ServeResponse.json({"ok": True})

    async def validated(call: Call) -> ServeResponse:
        assert isinstance(call.input, _Validated)
        return ServeResponse.json(call.input.model_dump())

    async def boom(call: Call) -> ServeResponse:
        raise RuntimeError(FIXTURES["leakCanary"])

    api = create_api(
        auth=authenticate,
        security=HttpSecurity(allowed_hosts=("testserver",)),
        production=ProductionProfile() if production else None,
    )
    api.add_route("GET", "/protected", ok)
    api.add_route("POST", "/validated", validated, input=TypeAdapter(_Validated))
    api.add_route("GET", "/boom", boom)
    api.add_route("GET", "/limited", ok, limits=[RateLimit(max=1, window_seconds=60)])
    api.add_route(
        "GET",
        "/limiter-down",
        ok,
        limits=[RateLimit(store=_FailingStore(), fail_open=False)],
    )
    return api


def _client(transport: str) -> AsgiClient | CoreClient:
    api = _api(transport.endswith("-production"))
    if transport.startswith("core"):
        return CoreClient(api)
    return AsgiClient(to_asgi_app(api))


def _send(client: AsgiClient | CoreClient, request: dict[str, Any]) -> Any:
    headers = {}
    if request["credential"] == "valid":
        headers["Authorization"] = f"Bearer {CREDENTIAL}"
    elif request["credential"] == "invalid":
        headers["Authorization"] = f"Bearer {CREDENTIAL}-wrong"
    if "json" in request:
        return client.request(
            request["method"], request["path"], headers=headers, json=request["json"]
        )
    return client.request(request["method"], request["path"], headers=headers)


@pytest.mark.parametrize("case", FIXTURES["cases"], ids=[case["id"] for case in FIXTURES["cases"]])
@pytest.mark.parametrize("transport", TRANSPORTS)
def test_errors_v1(case: dict[str, Any], caplog: pytest.LogCaptureFixture, transport: str) -> None:
    client = _client(transport)
    response = None
    for request in case["requests"]:
        response = _send(client, request)
        if "expectStatus" in request:
            assert response.status_code == request["expectStatus"]
    assert response is not None

    envelope = FIXTURES["envelope"]
    body = response.json()
    error = body["error"]

    # The envelope, identical for every error.
    assert list(body) == envelope["bodyKeys"]
    assert set(error) <= set(envelope["errorKeys"])
    assert isinstance(error["type"], str)
    assert isinstance(error["message"], str)
    assert response.headers.get(envelope["requestIdHeader"])
    for name, value in envelope["requiredHeaders"].items():
        assert response.headers.get(name) == value
    details = error.get("details")
    if details is not None:
        assert set(details) <= set(envelope["allowedDetailKeys"])
    for marker in FIXTURES["leakMarkers"]:
        assert marker not in response.text

    # The case.
    expected = case["expect"]
    assert response.status_code == expected["status"]
    assert error["type"] == expected["type"]
    assert error["message"] == expected["message"]
    for key, value in expected.get("details", {}).items():
        assert details is not None
        assert details[key] == value
    if expected.get("noDetails"):
        assert details is None
    if "issuePaths" in expected:
        issues = (details or {}).get("issues", [])
        assert [issue["path"] for issue in issues] == expected["issuePaths"]
        assert all(isinstance(issue["message"], str) for issue in issues)
    for name, value in expected.get("headers", {}).items():
        assert response.headers.get(name) == value

"""Runs the language-neutral serve HTTP error fixtures (specs/serve-http).

`@hypequery/serve` runs the same file in `serve-http-fixtures.test.ts`. A
divergence between the two is a bug in one of them or in the fixtures.
"""

# No `from __future__ import annotations`: FastAPI resolves endpoint
# annotations at registration, and these endpoints close over local routers.
import json
from pathlib import Path
from typing import Any

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel, ConfigDict

from hypequery.serve import (
    Credential,
    HttpSecurity,
    Principal,
    ProductionProfile,
    RateLimit,
    create_app,
    create_router,
    install_http_security,
)

FIXTURES = json.loads(
    (
        Path(__file__).resolve().parents[3] / "specs/serve-http/fixtures/errors-v1/cases.json"
    ).read_text(encoding="utf-8")
)
CREDENTIAL = FIXTURES["app"]["credential"]


class _FailingStore:
    async def hit(self, key: str, window_seconds: int) -> tuple[int, float]:
        raise RuntimeError("store offline")


class _Validated(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    limit: float


def _app(production: bool = False) -> FastAPI:
    """The fixture app described in cases.json, fresh for each case."""

    def authenticate(credential: Credential) -> Principal | None:
        return Principal(subject="alice") if credential.value == CREDENTIAL else None

    router = create_router(authenticate=authenticate)

    @router.get("/protected")
    def protected() -> dict[str, bool]:
        return {"ok": True}

    @router.post("/validated")
    def validated(payload: _Validated) -> dict[str, Any]:
        return payload.model_dump()

    @router.get("/boom")
    def boom() -> None:
        raise RuntimeError(FIXTURES["leakCanary"])

    @router.get("/limited", dependencies=[Depends(RateLimit(max=1, window_seconds=60))])
    def limited() -> dict[str, bool]:
        return {"ok": True}

    @router.get(
        "/limiter-down",
        dependencies=[Depends(RateLimit(store=_FailingStore(), fail_open=False))],
    )
    def limiter_down() -> dict[str, bool]:
        return {"ok": True}

    if production:
        return create_app(
            router,
            security=HttpSecurity(allowed_hosts=("testserver",)),
            production=ProductionProfile(),
        )
    app = FastAPI()
    app.include_router(router)
    install_http_security(app, HttpSecurity(allowed_hosts=("testserver",)))
    return app


def _send(client: TestClient, request: dict[str, Any]) -> Any:
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
@pytest.mark.parametrize("production", [False, True], ids=["embedded", "production"])
def test_errors_v1(
    case: dict[str, Any], caplog: pytest.LogCaptureFixture, production: bool
) -> None:
    client = TestClient(_app(production), raise_server_exceptions=False)
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

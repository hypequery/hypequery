"""Every response from the core carries the baseline security headers, on every adapter.

`X-Content-Type-Options: nosniff` and a Content-Security-Policy that lets a
response opened as a document run, load and frame nothing; the development docs
page sets its own policy instead, for the one pinned script it loads.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from hypequery.serve import (
    Call,
    CorsPolicy,
    Credential,
    HttpSecurity,
    Principal,
    RateLimit,
    ServeResponse,
    create_api,
)
from hypequery.serve.core.utils.docs_html import DOCS_POLICY, REDOC_INTEGRITY, REDOC_URL
from hypequery.serve.core.utils.security_headers import NO_DOCUMENT_POLICY
from hypequery.serve.utils.fault import fault_response
from serve_transports import TRANSPORTS, serve_client

AUTH = {"Authorization": "Bearer token"}
ORIGIN = "https://app.example"


def _api() -> Any:
    def authenticate(credential: Credential) -> Principal | None:
        return Principal(subject="alice") if credential.value == "token" else None

    async def ok(call: Call) -> ServeResponse:
        return ServeResponse.json({"ok": True})

    async def boom(call: Call) -> ServeResponse:
        raise RuntimeError("unexpected")

    api = create_api(
        auth=authenticate,
        security=HttpSecurity(allowed_hosts=("testserver",), cors=CorsPolicy(origins=(ORIGIN,))),
        development_docs=True,
    )
    api.add_route("GET", "/private", ok)
    api.add_route("GET", "/public", ok, public=True)
    api.add_route("GET", "/boom", boom)
    api.add_route("GET", "/limited", ok, limits=[RateLimit(max=1, window_seconds=60)])
    return api


REQUESTS: list[tuple[str, str, str, dict[str, str]]] = [
    ("authenticated", "GET", "/private", AUTH),
    ("public", "GET", "/public", {}),
    ("unauthenticated", "GET", "/private", {}),
    ("failing handler", "GET", "/boom", AUTH),
    ("not found", "GET", "/missing", {}),
    ("cross-origin", "GET", "/private", {**AUTH, "Origin": ORIGIN}),
    (
        "preflight",
        "OPTIONS",
        "/private",
        {"Origin": ORIGIN, "Access-Control-Request-Method": "GET"},
    ),
    (
        "refused preflight",
        "OPTIONS",
        "/private",
        {"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    ),
    ("invalid host", "GET", "/private", {**AUTH, "Host": "evil.example"}),
    ("openapi", "GET", "/openapi.json", {}),
]


@pytest.mark.parametrize("transport", TRANSPORTS)
@pytest.mark.parametrize(
    ("name", "method", "path", "headers"), REQUESTS, ids=[item[0] for item in REQUESTS]
)
def test_every_response_carries_the_baseline_headers(
    transport: str, name: str, method: str, path: str, headers: dict[str, str]
) -> None:
    response = serve_client(transport, _api()).request(method, path, headers=headers)
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-security-policy"] == NO_DOCUMENT_POLICY


@pytest.mark.parametrize("transport", TRANSPORTS)
def test_rate_limited_and_refused_host_answers_are_not_stored(transport: str) -> None:
    client = serve_client(transport, _api())
    client.get("/limited", headers=AUTH)
    limited = client.get("/limited", headers=AUTH)
    assert limited.status_code == 429
    assert limited.headers["x-content-type-options"] == "nosniff"
    refused = client.get("/private", headers={"Host": "evil.example"})
    assert refused.status_code == 400
    assert refused.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("transport", TRANSPORTS)
def test_docs_page_pins_its_script_and_sets_its_own_policy(transport: str) -> None:
    response = serve_client(transport, _api()).get("/docs")
    assert response.status_code == 200
    assert response.headers["content-security-policy"] == DOCS_POLICY
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"
    scripts = re.findall(r"<script [^>]*>", response.text)
    assert scripts == [
        f'<script src="{REDOC_URL}" integrity="{REDOC_INTEGRITY}" crossorigin="anonymous">'
    ]
    # An exact release: a floating tag such as @2 or @latest cannot carry a digest.
    assert re.search(r"/redoc@\d+\.\d+\.\d+/", REDOC_URL)
    assert f"script-src {REDOC_URL};" in DOCS_POLICY
    assert "frame-ancestors 'none'" in DOCS_POLICY


def test_a_route_keeps_its_own_content_security_policy() -> None:
    async def page(call: Call) -> ServeResponse:
        return ServeResponse(
            status=200,
            headers={"Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'"},
            body=b"<p>hi</p>",
        )

    api = _api()
    api.add_route("GET", "/page", page, public=True)
    response = serve_client("core", api).get("/page")
    assert response.headers["content-security-policy"] == "default-src 'self'"


def test_a_fault_in_the_core_still_carries_the_baseline_headers() -> None:
    try:
        raise RuntimeError("fault")
    except RuntimeError:
        response = fault_response()
    assert response.status == 500
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-security-policy"] == NO_DOCUMENT_POLICY

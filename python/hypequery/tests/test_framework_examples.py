"""The Django, Flask, pandas and SQLAlchemy examples, run against a seeded database."""

from __future__ import annotations

import asyncio
import importlib
import os
import secrets
from collections.abc import Iterator
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

TOKENS = {"HYPEQUERY_TENANT_A_TOKEN": "tenant-a-test", "HYPEQUERY_TENANT_B_TOKEN": "tenant-b-test"}
A = {"Authorization": "Bearer tenant-a-test"}
SAME_ORIGIN = {"Sec-Fetch-Site": "same-origin"}
B = {"Authorization": "Bearer tenant-b-test"}
BY_COUNTRY_A = [
    {"country": "DE", "revenue": 20.0, "orderCount": 1},
    {"country": "US", "revenue": 10.0, "orderCount": 1},
]
DAILY_A = [
    {"period": "2026-01-01 00:00:00", "revenue": 10.0},
    {"period": "2026-01-02 00:00:00", "revenue": 20.0},
]


def _json(response: Any) -> Any:
    return response.get_json()


def _assert_serves_hypequery_endpoints(post: Any, get: Any) -> None:
    """The example's token-authenticated hypequery endpoints, as MCP calls them."""

    query = {"measures": ["revenue"]}
    assert post("/api/agents/orders", query, A) == (200, [{"revenue": "30"}])
    assert post("/api/agents/orders", query, B) == (200, [{"revenue": "90"}])
    assert post("/api/agents/orders", query, {})[0] == 401
    # A token is not a session: the React page's API refuses it.
    assert post("/api/analytics/orders", query, {**A, **SAME_ORIGIN})[0] == 401
    live = get("/api/agents/client-contract", A)
    assert [endpoint["path"] for endpoint in live["endpoints"]] == ["/api/agents/orders"]


def _assert_serves_the_session(post: Any, get: Any, sign_in: Any, sign_out: Any) -> None:
    """The React page's endpoints: the app's own login, with no token."""

    from examples.utils.analytics import build

    query = {"measures": ["revenue"]}
    assert post("/api/analytics/orders", query, SAME_ORIGIN)[0] == 401
    assert sign_in("not-a-token") == 401
    assert sign_in("tenant-a-test") == 204
    assert post("/api/analytics/orders", query, SAME_ORIGIN) == (200, [{"revenue": "30"}])
    # The core's same-origin check: an unsafe request the browser did not mark.
    assert post("/api/analytics/orders", query, {})[0] == 403
    live = get("/api/analytics/client-contract", {})
    # The offline export the page's client is generated from pins the served schema.
    offline = build()["contract"]["endpoints"]
    assert [endpoint["path"] for endpoint in live["endpoints"]] == ["/api/analytics/orders"]
    assert live["endpoints"][0]["schemaHash"] == offline[0]["schemaHash"]
    assert sign_out() == 204
    assert post("/api/analytics/orders", query, SAME_ORIGIN)[0] == 401
    assert sign_in("tenant-b-test") == 204
    assert post("/api/analytics/orders", query, SAME_ORIGIN) == (200, [{"revenue": "90"}])


def _sorted(rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: row[key])


@pytest.mark.parametrize(
    "name",
    [
        "examples.django_app",
        "examples.flask_app",
        "examples.dataframes",
        "examples.sqlalchemy_engine",
        "examples.utils.analytics",
    ],
)
def test_framework_examples_import_without_credentials_or_connections(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    import clickhouse_connect

    def refuse(*args: object, **kwargs: object) -> None:
        pytest.fail("Importing an example must not connect to ClickHouse")

    monkeypatch.setattr(clickhouse_connect, "get_client", refuse)
    for variable in TOKENS:
        monkeypatch.delenv(variable, raising=False)
    module: ModuleType = importlib.import_module(name)
    importlib.reload(module)


@pytest.fixture
def seeded(monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    """A fresh database seeded with examples/seed.sql; yields its SQLAlchemy URL."""

    if "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ:
        pytest.skip("live ClickHouse required")
    import clickhouse_connect

    host = os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"]
    port = os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123")
    password = os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"]
    database = f"hq_framework_examples_{secrets.token_hex(6)}"
    monkeypatch.delenv("CLICKHOUSE_URL", raising=False)
    for name in ("CLICKHOUSE_SECURE", "CLICKHOUSE_USERNAME"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CLICKHOUSE_HOST", host)
    monkeypatch.setenv("CLICKHOUSE_PORT", port)
    monkeypatch.setenv("CLICKHOUSE_DATABASE", database)
    monkeypatch.setenv("CLICKHOUSE_PASSWORD", password)
    for name, token in TOKENS.items():
        monkeypatch.setenv(name, token)
    server = clickhouse_connect.get_client(
        host=host, port=int(port), username="default", password=password
    )
    server.command(f"CREATE DATABASE {database}")
    try:
        admin = clickhouse_connect.get_client(
            host=host, port=int(port), username="default", password=password, database=database
        )
        try:
            seed = (Path(__file__).parents[1] / "examples/seed.sql").read_text()
            for statement in seed.split(";"):
                if statement.strip():
                    admin.command(statement)
        finally:
            admin.close()
        yield f"clickhousedb://default:{password}@{host}:{port}/{database}"
    finally:
        try:
            server.command(f"DROP DATABASE IF EXISTS {database}")
        finally:
            server.close()


def test_live_dataframes_example(seeded: str) -> None:
    pytest.importorskip("pandas")
    from examples import dataframes

    frame = dataframes.daily_revenue("a")
    assert str(frame["period"].dtype) == "datetime64[us, UTC]"
    assert str(frame["revenue"].dtype) == "float64"
    assert str(frame["orderCount"].dtype) == "Int64"
    assert frame["revenue"].sum() == 30
    assert dataframes.daily_revenue("b")["revenue"].sum() == 90


def test_live_sqlalchemy_example(seeded: str) -> None:
    pytest.importorskip("sqlalchemy")
    from examples import sqlalchemy_engine

    assert sqlalchemy_engine.compare(seeded, "a") == {"sqlalchemy": 30.0, "hypequery": 30.0}
    assert sqlalchemy_engine.compare(seeded, "b") == {"sqlalchemy": 90.0, "hypequery": 90.0}


def test_live_flask_example(seeded: str) -> None:
    pytest.importorskip("flask")
    from examples import flask_app

    app = flask_app.create_app()
    http = app.test_client()
    try:
        assert _sorted(_json(http.get("/revenue", headers=A))["data"], "country") == BY_COUNTRY_A
        assert _json(http.get("/revenue", headers=B))["data"] == [
            {"country": "US", "revenue": 90.0, "orderCount": 1}
        ]
        assert http.get("/revenue").status_code == 401
        assert _sorted(_json(http.get("/revenue/daily", headers=A))["data"], "period") == DAILY_A

        def post(url: str, body: Any, headers: dict[str, str]) -> tuple[int, Any]:
            response = http.post(url, json=body, headers=headers)
            return response.status_code, (response.get_json() or {}).get("data")

        def get(url: str, headers: dict[str, str]) -> Any:
            return http.get(url, headers=headers).get_json()

        _assert_serves_hypequery_endpoints(post, get)
        assert b"@hypequery/react" in http.get("/").data

        def sign_in(token: str) -> int:
            return http.post("/login", data={"token": token}, headers=SAME_ORIGIN).status_code

        def sign_out() -> int:
            return http.post("/logout", headers=SAME_ORIGIN).status_code

        _assert_serves_the_session(post, get, sign_in, sign_out)
        # The app's own routes take the session too.
        assert http.get("/revenue").get_json()["data"] == [
            {"country": "US", "revenue": 90.0, "orderCount": 1}
        ]
        # Sign-in is refused from another site's page.
        cross_site = {"Sec-Fetch-Site": "cross-site"}
        assert http.post("/login", data={"token": "x"}, headers=cross_site).status_code == 403
    finally:
        with app.app_context():
            flask_app.hq.close()


def test_live_django_example(seeded: str) -> None:
    pytest.importorskip("django")
    import httpx
    from django.test import Client, override_settings
    from examples import django_app

    from django_settings import migrated
    from hypequery.contrib.django import close_clients

    django_app.configure()
    migrated()
    keys = ("ROOT_URLCONF", "MIDDLEWARE", "HYPEQUERY", "ALLOWED_HOSTS")
    with override_settings(**{key: django_app.SETTINGS[key] for key in keys}):
        try:
            http = Client()
            response = http.get("/revenue", headers=A)
            assert response.status_code == 200, response.content
            assert _sorted(response.json()["data"], "country") == BY_COUNTRY_A
            assert http.get("/revenue").status_code == 401

            application = django_app.asgi_application()

            async def over_asgi() -> httpx.Response:
                transport = httpx.ASGITransport(app=application)
                async with httpx.AsyncClient(
                    transport=transport, base_url="http://localhost"
                ) as client:
                    return await client.get("/revenue/daily", headers=A)

            daily = asyncio.run(over_asgi())
            assert daily.status_code == 200, daily.text
            assert _sorted(daily.json()["data"], "period") == DAILY_A

            def post(url: str, body: Any, headers: dict[str, str]) -> tuple[int, Any]:
                response = http.post(url, body, content_type="application/json", headers=headers)
                return response.status_code, response.json().get("data")

            def get(url: str, headers: dict[str, str]) -> Any:
                return http.get(url, headers=headers).json()

            _assert_serves_hypequery_endpoints(post, get)

            # The React page's session, with Django's CSRF checks enforced.
            browser = Client(enforce_csrf_checks=True)
            assert b"@hypequery/react" in browser.get("/").content

            def csrf() -> dict[str, str]:
                # Read per request, as the page does: signing in rotates the token.
                return {"X-CSRFToken": browser.cookies["csrftoken"].value}

            def session_post(url: str, body: Any, headers: dict[str, str]) -> tuple[int, Any]:
                response = browser.post(
                    url, body, content_type="application/json", headers={**csrf(), **headers}
                )
                return response.status_code, response.json().get("data")

            def session_get(url: str, headers: dict[str, str]) -> Any:
                return browser.get(url, headers=headers).json()

            def sign_in(token: str) -> int:
                return int(browser.post("/login", {"token": token}, headers=csrf()).status_code)

            def sign_out() -> int:
                return int(browser.post("/logout", headers=csrf()).status_code)

            _assert_serves_the_session(session_post, session_get, sign_in, sign_out)
            # Django's CSRF middleware checks the session API: no token, refused.
            refused = browser.post(
                "/api/analytics/orders",
                {"measures": ["revenue"]},
                content_type="application/json",
                headers=SAME_ORIGIN,
            )
            assert refused.status_code == 403
            assert b"CSRF" in refused.content
            # The project's own views take the session too.
            assert browser.get("/revenue").json()["data"] == [
                {"country": "US", "revenue": 90.0, "orderCount": 1}
            ]

            async def over_asgi_api() -> httpx.Response:
                transport = httpx.ASGITransport(app=application)
                async with httpx.AsyncClient(
                    transport=transport, base_url="http://localhost"
                ) as client:
                    return await client.post(
                        "/api/agents/orders", json={"measures": ["revenue"]}, headers=B
                    )

            served = asyncio.run(over_asgi_api())
            assert served.status_code == 200, served.text
            assert served.json()["data"] == [{"revenue": "90"}]
        finally:
            close_clients()


@pytest.mark.parametrize(
    "name",
    [
        "examples.dataframes",
        "examples.sqlalchemy_engine",
        "examples.django_app",
        "examples.flask_app",
    ],
)
def test_framework_examples_do_not_need_fastapi(name: str) -> None:
    import subprocess
    import sys
    import textwrap

    source = f"""
        import sys

        sys.modules["fastapi"] = None
        import {name}
        """
    result = subprocess.run(
        [sys.executable, "-c", textwrap.dedent(source)],
        capture_output=True,
        text=True,
        check=False,
        cwd=Path(__file__).parents[1],
    )
    assert result.returncode == 0, result.stderr

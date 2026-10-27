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


def _sorted(rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: row[key])


@pytest.mark.parametrize(
    "name",
    [
        "examples.django_app",
        "examples.flask_app",
        "examples.dataframes",
        "examples.sqlalchemy_engine",
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
        mounted = http.post(
            "/api/analytics/orders", json={}, headers=A, base_url="http://localhost"
        )
        assert mounted.status_code == 200, mounted.get_data(as_text=True)
        assert _json(mounted)["data"][0]["revenue"] == "30"
        assert http.post("/api/analytics/orders", json={}).status_code == 401
    finally:
        with app.app_context():
            flask_app.hq.close()


def test_live_django_example(seeded: str) -> None:
    pytest.importorskip("django")
    import httpx
    from django.test import Client, override_settings
    from examples import django_app

    from hypequery.contrib.django import close_clients

    django_app.configure()
    keys = ("ROOT_URLCONF", "MIDDLEWARE", "HYPEQUERY", "ALLOWED_HOSTS")
    with override_settings(**{key: django_app.SETTINGS[key] for key in keys}):
        try:
            http = Client()
            response = http.get("/revenue", headers=A)
            assert response.status_code == 200, response.content
            assert _sorted(response.json()["data"], "country") == BY_COUNTRY_A
            assert http.get("/revenue").status_code == 401

            application = django_app.asgi_application()

            async def over_asgi() -> tuple[httpx.Response, httpx.Response]:
                transport = httpx.ASGITransport(app=application)
                async with httpx.AsyncClient(
                    transport=transport, base_url="http://localhost"
                ) as client:
                    daily = await client.get("/revenue/daily", headers=A)
                    mounted = await client.post("/api/analytics/orders", json={}, headers=B)
                return daily, mounted

            daily, mounted = asyncio.run(over_asgi())
            assert daily.status_code == 200, daily.text
            assert _sorted(daily.json()["data"], "period") == DAILY_A
            assert mounted.status_code == 200, mounted.text
            assert mounted.json()["data"][0]["revenue"] == "90"
        finally:
            close_clients()


@pytest.mark.parametrize("name", ["examples.dataframes", "examples.sqlalchemy_engine"])
def test_standalone_examples_do_not_need_fastapi(name: str) -> None:
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

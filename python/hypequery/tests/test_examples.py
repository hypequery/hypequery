"""Exercise the runnable examples against the integration database."""

from __future__ import annotations

import importlib
import os
import secrets
from pathlib import Path

import pytest
from examples import embedded_analytics, governed_agent, multitenant_saas
from fastapi.testclient import TestClient


@pytest.mark.parametrize("module", [embedded_analytics, multitenant_saas, governed_agent])
def test_examples_import_without_credentials_or_connections(
    module: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    from types import ModuleType
    from typing import cast

    from examples.utils import server

    def refuse_connection(*args: object, **kwargs: object) -> None:
        pytest.fail("Importing an example must not connect to ClickHouse")

    monkeypatch.setattr(server, "create_clickhouse_executor", refuse_connection)
    for name in (
        "HYPEQUERY_EXAMPLE_TOKEN",
        "HYPEQUERY_TENANT_A_TOKEN",
        "HYPEQUERY_TENANT_B_TOKEN",
        "HYPEQUERY_AGENT_TOKEN",
    ):
        monkeypatch.delenv(name, raising=False)
    importlib.reload(cast(ModuleType, module))


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ, reason="live ClickHouse required"
)
def test_live_examples_seed_and_http_journeys(monkeypatch: pytest.MonkeyPatch) -> None:
    import clickhouse_connect

    monkeypatch.setenv("CLICKHOUSE_HOST", os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"])
    monkeypatch.setenv("CLICKHOUSE_PORT", os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123"))
    # A fresh database per run: the test only ever drops the database it created.
    database = f"hq_examples_{secrets.token_hex(6)}"
    monkeypatch.setenv("CLICKHOUSE_DATABASE", database)
    monkeypatch.setenv("CLICKHOUSE_PASSWORD", os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"])
    monkeypatch.setenv("HYPEQUERY_EXAMPLE_TOKEN", "example-test")
    monkeypatch.setenv("HYPEQUERY_TENANT_A_TOKEN", "tenant-a-test")
    monkeypatch.setenv("HYPEQUERY_TENANT_B_TOKEN", "tenant-b-test")
    monkeypatch.setenv("HYPEQUERY_AGENT_TOKEN", "agent-test")
    server = clickhouse_connect.get_client(
        host=os.environ["CLICKHOUSE_HOST"],
        port=int(os.environ["CLICKHOUSE_PORT"]),
        username="default",
        password=os.environ["CLICKHOUSE_PASSWORD"],
    )
    server.command(f"CREATE DATABASE {database}")
    admin = None
    try:
        admin = clickhouse_connect.get_client(
            host=os.environ["CLICKHOUSE_HOST"],
            port=int(os.environ["CLICKHOUSE_PORT"]),
            username="default",
            password=os.environ["CLICKHOUSE_PASSWORD"],
            database=database,
        )
        seed = (Path(__file__).parents[1] / "examples/seed.sql").read_text()
        for _ in range(2):
            for statement in seed.split(";"):
                if statement.strip():
                    admin.command(statement)
        assert admin.query("SELECT count() FROM example_orders").result_rows == [(3,)]
        for factory, path, token, expected in (
            (embedded_analytics.create_application, "/analytics/orders", "example-test", "120"),
            (multitenant_saas.create_application, "/analytics/orders", "tenant-a-test", "30"),
            (multitenant_saas.create_application, "/analytics/orders", "tenant-b-test", "90"),
            (governed_agent.create_application, "/agent/revenue", "agent-test", "30"),
        ):
            app = factory()
            with TestClient(app, base_url="http://localhost") as http:
                headers = {"Authorization": "Bearer " + token}
                assert http.get("/openapi.json", headers=headers).status_code == 404
                assert http.post(path, json={}).status_code == 401
                response = http.post(path, json={}, headers=headers)
                assert response.status_code == 200, response.text
                assert response.json()["data"][0]["revenue"] == expected
                assert response.headers["cache-control"] == "no-store"
                grouped = http.post(
                    path,
                    json={"dimensions": ["country"], "limit": 10000, "includeMeta": True},
                    headers=headers,
                )
                assert grouped.status_code == 200, grouped.text
                assert grouped.json()["meta"]["pagination"]["limit"] <= 100
                assert http.post(path, json={"tenant": "b"}, headers=headers).status_code == 400
                if path == "/agent/revenue":
                    assert grouped.json()["meta"]["pagination"]["limit"] == 20
                    discovery = http.get("/discovery", headers=headers)
                    assert discovery.status_code == 200
                    for marker in ("example_orders", "org_id", "sql", "parameters"):
                        assert marker not in discovery.text
                    # Requests the agent could plausibly send with real names are
                    # still refused: the endpoint fixes its measure, refuses
                    # aggregate conditions, and never lets a filter choose a tenant.
                    for payload in (
                        {"measures": ["revenue"]},
                        {"having": [{"measure": "revenue", "operator": "gt", "value": 0}]},
                        {"filters": [{"field": "org_id", "operator": "eq", "value": "b"}]},
                        {"sql": "SELECT * FROM example_orders"},
                    ):
                        denied = http.post(path, json=payload, headers=headers)
                        assert denied.status_code == 400, payload
                        assert denied.json()["error"]["type"] == "VALIDATION_ERROR"
                    allowed = http.post(
                        path,
                        json={"filters": [{"field": "country", "operator": "eq", "value": "US"}]},
                        headers=headers,
                    )
                    assert allowed.json()["data"] == [{"revenue": "10"}]
    finally:
        try:
            if admin is not None:
                admin.close()
            server.command(f"DROP DATABASE IF EXISTS {database}")
        finally:
            server.close()

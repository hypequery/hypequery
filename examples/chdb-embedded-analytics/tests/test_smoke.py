"""Smoke test with no ClickHouse server: chDB builds the data in-process, the
numbers are pinned, and the same datasets are checked against raw SQL."""

from __future__ import annotations

import io
import json
import os
import socket
from urllib.parse import urlsplit

import chdb
import httpx
import pytest

import report
from analytics.backend import open_client, open_executor
from analytics.datasets import events
from app import DEV_TOKEN, app

# Deterministic: the generator uses integer hashing only.
EVENTS_BY_PLAN = {"enterprise": 72883, "growth": 47166, "starter": 42949, "free": 37002}


def raw(sql: str) -> list[dict]:
    """Ground truth straight from chDB, bypassing hypequery."""
    connection = chdb.connect(os.environ["CHDB_PATH"])
    try:
        return json.loads(connection.query(sql, "JSON").bytes())["data"]
    finally:
        connection.close()


def test_report_cli_prints_the_example_request_shape() -> None:
    out = io.StringIO()
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("sys.stdout", out)
        assert report.main(["--by", "tenant.plan"]) == 0
    body = json.loads(out.getvalue())
    assert body["backend"] == "chdb" and body["by"] == "tenant.plan"
    assert [row["tenant.plan"] for row in body["data"]] == list(EVENTS_BY_PLAN)  # ordered by events desc
    for row in body["data"]:
        assert set(row) == {"tenant.plan", "events", "unique_users", "p95_latency_ms", "error_rate"}
        assert row["events"] == EVENTS_BY_PLAN[row["tenant.plan"]]
        assert 0 < row["error_rate"] < 0.1
        # quantile() samples, so p95 moves a little between runs; the tail sits above 1000ms.
        assert 1000 < row["p95_latency_ms"] < 4300


def test_measures_match_raw_sql() -> None:
    expected = {
        r["event_type"]: r
        for r in raw(
            "SELECT event_type, count() AS events, uniqExact(user_id) AS users, "
            "countIf(status_code >= 500) / count() AS error_rate FROM events GROUP BY event_type"
        )
    }
    rows = report.run_report("event_type")["data"]
    assert sum(r["events"] for r in rows) == 200_000
    for row in rows:
        truth = expected[row["event_type"]]
        assert row["events"] == int(truth["events"])
        assert row["unique_users"] == int(truth["users"])
        assert row["error_rate"] == pytest.approx(truth["error_rate"])


async def test_http_api_serves_the_same_dataset() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as http:
        body = {"dimensions": ["tenant.plan"], "measures": ["events", "error_rate"],
                "orderBy": [{"field": "events", "direction": "desc"}]}
        ok = await http.post("/datasets/events/query", json=body, headers={"authorization": f"Bearer {DEV_TOKEN}"})
        assert ok.status_code == 200, ok.text
        # Measures are strings on the HTTP wire, so decimals keep their precision.
        assert {row["tenant.plan"]: int(row["events"]) for row in ok.json()["data"]} == EVENTS_BY_PLAN
        assert (await http.post("/datasets/events/query", json=body)).status_code == 401


def clickhouse_reachable() -> bool:
    url = urlsplit(os.environ.get("CLICKHOUSE_URL", "http://localhost:8123"))
    try:
        with socket.create_connection((url.hostname or "localhost", url.port or 8123), timeout=0.5):
            return True
    except OSError:
        return False


@pytest.mark.skipif(not clickhouse_reachable(), reason="no ClickHouse server; chDB needs none")
def test_same_datasets_run_on_a_clickhouse_server() -> None:
    """Portability: only the executor changes. Runs in CI, where the seed is up."""
    query = {"dimensions": ["tenant.plan"], "measures": list(report.MEASURES)}
    with open_executor("chdb") as embedded, open_executor("clickhouse") as server:
        local = open_client(embedded).execute(events, query).data
        remote = open_client(server).execute(events, query).data
    assert {tuple(sorted(r)) for r in local} == {tuple(sorted(r)) for r in remote}
    assert {r["tenant.plan"] for r in remote} <= {"free", "starter", "growth", "enterprise"}

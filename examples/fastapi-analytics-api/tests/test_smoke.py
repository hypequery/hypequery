"""Smoke test against the seed: tenant isolation, auth, and the report route."""

from __future__ import annotations

import httpx
import pytest
from clickhouse_connect import get_client

from analytics.connection import connection_from_env
from app import DEMO_USERS, app

RANGE = ("2026-10-02 00:00:00", "2026-10-31 23:59:59")


def raw_count(tenant_id: int) -> int:
    """Ground truth straight from the driver, bypassing hypequery."""
    c = connection_from_env()
    ch = get_client(host=c.host, port=c.port, username=c.username, password=c.password, database=c.database)
    return int(
        ch.command(
            "SELECT count() FROM events WHERE tenant_id = {t:UInt32} AND occurred_at BETWEEN {a:String} AND {b:String}",
            parameters={"t": tenant_id, "a": RANGE[0], "b": RANGE[1]},
        )
    )


@pytest.fixture
async def http():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def token_for(http: httpx.AsyncClient, email: str) -> str:
    response = await http.post("/auth/token", json={"email": email})
    assert response.status_code == 200, response.text
    return response.json()["token"]


async def query(http: httpx.AsyncClient, token: str | None, body: dict) -> httpx.Response:
    headers = {"authorization": f"Bearer {token}"} if token else {}
    return await http.post("/analytics/datasets/events/query", json=body, headers=headers)


async def test_health_and_demo_users(http: httpx.AsyncClient) -> None:
    assert (await http.get("/health")).json() == {"status": "ok"}
    users = (await http.get("/auth/demo-users")).json()
    assert len(users) == 3 and all("tenant_id" not in u for u in users)


async def test_queries_are_scoped_to_the_token_tenant(http: httpx.AsyncClient) -> None:
    ada = await token_for(http, "ada@quartz.example")
    grace = await token_for(http, "grace@relay.example")
    body = {
        "measures": ["events"],
        "filters": [{"field": "occurred_at", "operator": "between", "value": list(RANGE)}],
    }
    a = await query(http, ada, body)
    g = await query(http, grace, body)
    assert a.status_code == 200, a.text
    assert g.status_code == 200, g.text
    assert int(a.json()["data"][0]["events"]) == raw_count(DEMO_USERS["ada@quartz.example"]["tenant_id"])
    assert int(g.json()["data"][0]["events"]) == raw_count(DEMO_USERS["grace@relay.example"]["tenant_id"])
    assert a.json()["data"][0]["events"] != g.json()["data"][0]["events"]


async def test_rejects_missing_or_forged_tokens_and_tenant_filters(http: httpx.AsyncClient) -> None:
    assert (await query(http, None, {"measures": ["events"]})).status_code == 401
    assert (await query(http, "not-a-jwt", {"measures": ["events"]})).status_code == 401
    assert (await http.post("/auth/token", json={"email": "mallory@nowhere.example"})).status_code == 401
    ada = await token_for(http, "ada@quartz.example")
    refused = await query(http, ada, {"measures": ["events"], "filters": [{"field": "tenant_id", "operator": "eq", "value": 170}]})
    assert refused.status_code == 400, refused.text


async def test_own_report_route_uses_the_same_scoping(http: httpx.AsyncClient) -> None:
    linus = await token_for(http, "linus@helix.example")
    response = await http.get("/reports/top-paths", headers={"authorization": f"Bearer {linus}"}, params={"limit": 3})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["tenant_id"] == "146"
    assert len(body["data"]) == 3
    assert all("path" in row and "events" in row for row in body["data"])
    assert (await http.get("/reports/top-paths")).status_code == 401

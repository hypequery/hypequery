"""Smoke test against the seed: Django's test client, ORM-backed users, and
every number checked against raw SQL through clickhouse_connect."""

from __future__ import annotations

from urllib.parse import unquote, urlsplit

import pytest
from clickhouse_connect import get_client
from django.core.management import call_command
from django.test import Client

from analytics.connection import clickhouse_url

pytestmark = pytest.mark.django_db
PERIOD = ("2026-10-02 00:00:00", "2026-10-31 23:59:59")  # the views' default window
WHERE = "tenant_id = {t:UInt32} AND occurred_at BETWEEN {a:String} AND {b:String}"


def raw(sql: str, tenant_id: int):
    """Ground truth straight from the driver, bypassing hypequery and Django."""
    url = urlsplit(clickhouse_url())
    ch = get_client(host=url.hostname, port=url.port, username=unquote(url.username or ""),
                    password=unquote(url.password or ""), database=unquote(url.path.strip("/")),
                    secure=url.scheme == "https")
    return ch.query(sql.format(where=WHERE), parameters={"t": tenant_id, "a": PERIOD[0], "b": PERIOD[1]}).result_rows


def get(path: str, user: str | None = "ada"):
    headers = {"X-Demo-User": user} if user else {}
    return Client(headers=headers).get(path)


def test_settings_pass_hypequerys_system_check() -> None:
    call_command("check")  # raises SystemCheckError on a bad HYPEQUERY setting


def test_overview_shape_matches_raw_sql() -> None:
    response = get("/api/overview")  # the manifest's exampleRequest
    assert response.status_code == 200, response.content
    body = response.json()
    assert body["organization"] == "Quartz Metrics" and body["plan"] == "enterprise"  # from the ORM
    assert body["period"] == list(PERIOD)
    assert set(body["data"]) == {"events", "active_users", "error_rate", "p95_latency_ms"}
    ((events, users, errors),) = raw("SELECT count(), uniqExact(user_id), countIf(status_code >= 500) FROM events WHERE {where}", 153)
    assert body["data"]["events"] == events
    assert body["data"]["active_users"] == users
    assert body["data"]["error_rate"] == pytest.approx(errors / events)
    assert body["data"]["p95_latency_ms"] > 0


def test_each_user_sees_only_their_tenant() -> None:
    for user, tenant_id in (("grace", 170), ("linus", 146)):
        body = get("/api/overview", user).json()
        ((events,),) = raw("SELECT count() FROM events WHERE {where}", tenant_id)
        assert body["data"]["events"] == events
    assert get("/api/overview", "grace").json()["data"] != get("/api/overview", "ada").json()["data"]


def test_timeseries_and_breakdown_match_raw_sql() -> None:
    series = get("/api/timeseries?by=week").json()
    assert series["by"] == "week" and all({"period", "events", "active_users"} <= row.keys() for row in series["data"])
    ((events,),) = raw("SELECT count() FROM events WHERE {where}", 153)
    assert sum(row["events"] for row in series["data"]) == events

    devices = get("/api/breakdown/device?limit=3").json()["data"]
    expected = raw("SELECT device, count() AS c FROM events WHERE {where} GROUP BY device ORDER BY c DESC LIMIT 3", 153)
    assert [(row["device"], row["events"]) for row in devices] == [tuple(r) for r in expected]


def test_refuses_anonymous_outsiders_and_bad_input() -> None:
    assert get("/api/overview", None).status_code == 401
    assert get("/api/overview", "nobody").status_code == 401  # unknown users are not created
    assert get("/api/overview", "mallory").status_code == 403  # a user with no organization
    assert get("/api/breakdown/tenant_id").status_code == 404  # not a breakdown dimension
    assert get("/api/timeseries?by=hour").status_code == 400
    assert get("/api/overview?from=yesterday").status_code == 400

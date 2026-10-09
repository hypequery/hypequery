"""Query-zone correctness, cache isolation and HTTP validation."""

from __future__ import annotations

import json
import os
import secrets
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from hypequery.datasets import (
    CachedRows,
    Dataset,
    DatasetQuery,
    MemoryCacheStore,
    ResultCache,
    create_dataset_client,
    dimension,
    measure,
    plan_dataset_query,
)
from hypequery.datasets.client.results import ResultRows
from hypequery.datasets.planner import CompiledQuery
from hypequery.datasets.query_helpers import (
    eq,
    gte,
    lt,
)
from hypequery.datasets.utils.query_timezone import time_filter_value, timezone_identity
from hypequery.serve import (
    HttpSecurity,
    Principal,
    add_dataset_endpoint,
    add_metric_endpoint,
    create_app,
    create_router,
)
from hypequery.serve.models import MetricRequest, QueryRequest

if TYPE_CHECKING:
    from clickhouse_connect.driver.client import Client

    from hypequery.execution import ClickHouseExecutor

LIVE = pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ, reason="live ClickHouse required"
)


def dataset() -> Dataset:
    return Dataset(
        name="events",
        source="events",
        time_key="occurred_at",
        dimensions={"at": dimension.timestamp(column="occurred_at")},
        measures={"rows": measure.count("occurred_at")},
    )


@pytest.mark.parametrize(
    "zone", ["+02:00", "../../etc/passwd", "Mars/City", "UTC'); SELECT 1 --", "", 4]
)
def test_reject_invalid_zone(zone: object) -> None:
    with pytest.raises(ValidationError):
        DatasetQuery.model_validate({"timezone": zone})
    for request in (QueryRequest, MetricRequest):
        with pytest.raises(ValidationError):
            request.model_validate({"timezone": zone})


def test_zone_bound_and_local_filter_interpretation() -> None:
    query = plan_dataset_query(
        dataset(),
        DatasetQuery(
            by="day", timezone="America/New_York", filters=(eq("at", "2026-03-08T00:00:00"),)
        ),
    )
    assert "America/New_York" not in query.sql
    assert "toStartOfDay(toDateTime64(`occurred_at`, 9, {p0:String}))" in query.sql
    assert query.parameter_values() == {"p0": "America/New_York", "p1": "2026-03-08T00:00:00-05:00"}
    assert time_filter_value("2026-03-08T07:00:00Z", "America/New_York") == "2026-03-08T07:00:00Z"
    assert (
        time_filter_value("2026-03-08T04:00:00", "America/New_York") == "2026-03-08T04:00:00-04:00"
    )


class RecordingExecutor:
    def __init__(self) -> None:
        self.queries: list[CompiledQuery] = []

    def execute(self, query: CompiledQuery) -> ResultRows:
        self.queries.append(query)
        return CachedRows(columns=("rows",), rows=((1,),))


def test_client_default_override_and_cache_separation() -> None:
    executor = RecordingExecutor()
    cache = ResultCache(store=MemoryCacheStore(), ttl_seconds=60, secret=b"a" * 32)
    client = create_dataset_client(executor=executor, timezone="America/New_York", cache=cache)
    client.execute(dataset(), {"by": "day"})
    client.execute(dataset(), {"by": "day"})
    client.execute(dataset(), {"by": "day", "timezone": "UTC"})
    assert len(executor.queries) == 2
    assert executor.queries[0].parameter_values()["p0"] == "America/New_York"
    assert executor.queries[1].parameter_values()["p0"] == "UTC"
    assert timezone_identity("a" * 64, None) == timezone_identity("a" * 64, "UTC")
    assert timezone_identity("a" * 64, "UTC") != timezone_identity("a" * 64, "America/New_York")
    with pytest.raises(ValueError, match="Invalid timezone"):
        create_dataset_client(executor=executor, timezone="bad")


@contextmanager
def live_database() -> Iterator[tuple[Client, ClickHouseExecutor]]:
    """A uniquely named database, dropped afterwards; never a shared fixed table."""
    import clickhouse_connect

    from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

    host = os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"]
    port = int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123"))
    password = os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"]
    admin = clickhouse_connect.get_client(
        host=host, port=port, username="default", password=password
    )
    database = f"hq_timezone_{secrets.token_hex(6)}"
    admin.command(f"CREATE DATABASE {database}")
    executor = None
    try:
        executor = create_clickhouse_executor(
            ClickHouseConnection(
                host=host, port=port, database=database, username="default", password=password
            )
        )
        admin.command(f"USE {database}")
        yield admin, executor
    finally:
        try:
            if executor is not None:
                executor.close()
        finally:
            try:
                admin.command(f"DROP DATABASE IF EXISTS {database}")
            finally:
                admin.close()


@LIVE
def test_live_zone_buckets_and_filters_match_raw_sql() -> None:

    with live_database() as (admin, executor):
        admin.command(
            "CREATE TABLE events (occurred_at DateTime64(3, 'America/New_York')) ENGINE=Memory"
        )
        admin.command(
            "INSERT INTO events VALUES ('2026-03-07 23:30:00'), "
            "('2026-03-08 01:30:00'), ('2026-03-08 03:30:00')"
        )
        client = create_dataset_client(executor=executor)
        for zone in ("UTC", "America/New_York", "America/Los_Angeles"):
            actual = client.execute(dataset(), {"by": "day", "timezone": zone})
            # Ground truth is ClickHouse's JSON text for the bucket, which is what
            # TypeScript returns (RFC 0015's result form).
            raw = admin.raw_query(
                "SELECT toStartOfDay(toDateTime64(occurred_at, 9, {zone:String})) "
                "AS period, count(occurred_at) AS rows FROM events "
                "GROUP BY period ORDER BY period",
                parameters={"zone": zone},
                fmt="JSONEachRow",
                settings={"output_format_json_quote_64bit_integers": 0},
            )
            expected = tuple(json.loads(line) for line in raw.decode().splitlines())
            assert actual.data == expected
        filtered = client.execute(
            dataset(),
            {
                "measures": ["rows"],
                "timezone": "America/New_York",
                "filters": [eq("at", "2026-03-08T01:30:00")],
            },
        )
        assert filtered.data[0]["rows"] == 1


@LIVE
@pytest.mark.parametrize("zone", ["UTC", "America/New_York", "Asia/Kathmandu"])
def test_live_date_columns_keep_calendar_dates(zone: str) -> None:
    # Matches TypeScript's "preserves Date32 calendar dates": a Date is a local
    # date in the query zone, so no zone moves a row into a neighbouring day.
    with live_database() as (admin, executor):
        admin.command("CREATE TABLE days (day Date, day32 Date32, value Float64) ENGINE=Memory")
        admin.command(
            "INSERT INTO days VALUES ('2026-01-02', '2026-01-02', 10), "
            "('2026-01-03', '2026-01-03', 20), ('2026-01-03', '2026-01-03', 30)"
        )
        client = create_dataset_client(executor=executor)
        for column in ("day", "day32"):
            days = Dataset(
                name="days",
                source="days",
                time_key=column,
                dimensions={column: dimension.timestamp()},
                measures={"total": measure.sum("value")},
            )
            result = client.execute(days, {"by": "day", "timezone": zone})
            assert result.data == (
                {"period": "2026-01-02 00:00:00", "total": 10.0},
                {"period": "2026-01-03 00:00:00", "total": 50.0},
            )


@LIVE
def test_live_offset_bounds_are_instants_and_local_bounds_follow_the_zone() -> None:
    with live_database() as (admin, executor):
        admin.command("CREATE TABLE events (occurred_at DateTime64(3, 'UTC')) ENGINE=Memory")
        # 2026-01-02 in New York is [05:00Z, next day 05:00Z).
        admin.command(
            "INSERT INTO events VALUES ('2026-01-01 23:30:00'), "
            "('2026-01-02 12:00:00'), ('2026-01-03 03:00:00')"
        )
        client = create_dataset_client(executor=executor)

        def rows(lower: str, upper: str) -> object:
            result = client.execute(
                dataset(),
                {
                    "measures": ["rows"],
                    "timezone": "America/New_York",
                    "filters": [gte("at", lower), lt("at", upper)],
                },
            )
            return result.data[0]["rows"]

        assert rows("2026-01-02T00:00:00Z", "2026-01-03T00:00:00Z") == 1
        assert rows("2026-01-02T00:00:00", "2026-01-03T00:00:00") == 2
        assert rows("2026-01-02", "2026-01-03") == 2


@LIVE
def test_live_period_form_matches_the_shared_typescript_fixture() -> None:
    fixture = json.loads(
        (Path(__file__).resolve().parents[3] / "specs/datasets/period-format-v1.json").read_text()
    )
    with live_database() as (admin, executor):
        admin.command("CREATE TABLE events (occurred_at DateTime64(3, 'UTC')) ENGINE=Memory")
        for instant in dict.fromkeys(case["instant"] for case in fixture["cases"]):
            admin.command(
                "INSERT INTO events SELECT parseDateTime64BestEffort({instant:String}, 3, 'UTC')",
                parameters={"instant": instant},
            )
        client = create_dataset_client(executor=executor)
        for case in fixture["cases"]:
            result = client.execute(
                dataset(),
                {
                    "by": case["grain"],
                    "timezone": case["timezone"],
                    "measures": ["rows"],
                    "filters": [eq("at", case["instant"])],
                },
            )
            assert [row["period"] for row in result.data] == [case["period"]], case


def _endpoint_client() -> tuple[RecordingExecutor, TestClient]:
    executor = RecordingExecutor()
    cache = ResultCache(store=MemoryCacheStore(), ttl_seconds=60, secret=b"b" * 32)
    client = create_dataset_client(executor=executor, timezone="Asia/Tokyo", cache=cache)
    router = create_router(authenticate=lambda credential: Principal(subject="reader"))
    add_dataset_endpoint(router, "/dataset", dataset=dataset(), client=client)
    add_metric_endpoint(router, "/metric", dataset=dataset(), client=client, measure="rows")
    app = create_app(router, security=HttpSecurity(allowed_hosts=("testserver",)))
    return executor, TestClient(app, headers={"Authorization": "Bearer test"})


@pytest.mark.parametrize("path", ["/dataset", "/metric"])
def test_endpoints_apply_client_default_and_request_override(path: str) -> None:
    executor, http = _endpoint_client()
    with http:
        assert http.post(path, json={"by": "day"}).status_code == 200
        response = http.post(path, json={"by": "day", "timezone": "America/New_York"})
        assert response.status_code == 200, response.text
        assert [query.parameter_values()["p0"] for query in executor.queries] == [
            "Asia/Tokyo",
            "America/New_York",
        ]
        invalid = http.post(path, json={"by": "day", "timezone": "+09:00"})
        assert invalid.status_code == 400
        assert invalid.json()["error"]["type"] == "VALIDATION_ERROR"
        assert len(executor.queries) == 2


def test_explicit_zone_equal_to_the_default_shares_its_cache_entry() -> None:
    executor = RecordingExecutor()
    cache = ResultCache(store=MemoryCacheStore(), ttl_seconds=60, secret=b"a" * 32)
    client = create_dataset_client(executor=executor, timezone="Asia/Tokyo", cache=cache)
    first = client.execute(dataset(), {"by": "day"})
    hit = client.execute(dataset(), {"by": "day", "timezone": "Asia/Tokyo"})
    assert len(executor.queries) == 1
    assert hit.data == first.data
    # The partition is the zone itself, so the default and an explicit UTC differ.
    client.execute(dataset(), {"by": "day", "timezone": "UTC"})
    assert len(executor.queries) == 2


def test_shared_timezone_partition_fixture() -> None:
    fixtures = json.loads(
        (
            Path(__file__).resolve().parents[3] / "specs/datasets/query-timezone-cache-v1.json"
        ).read_text()
    )
    for case in fixtures:
        assert timezone_identity(case["identity"], case["timezone"]) == case["partition"]


def test_base_timezone_validation_without_system_iana_data() -> None:
    import zoneinfo

    from hypequery.datasets.utils.query_timezone import validate_timezone

    original = zoneinfo.TZPATH
    try:
        zoneinfo.reset_tzpath(())
        zoneinfo.ZoneInfo.clear_cache()
        assert validate_timezone("UTC") == "UTC"
        assert validate_timezone("America/New_York") == "America/New_York"
        create_dataset_client(executor=RecordingExecutor())
    finally:
        zoneinfo.reset_tzpath(original)
        zoneinfo.ZoneInfo.clear_cache()

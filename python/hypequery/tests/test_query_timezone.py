"""Query-zone correctness, cache isolation and HTTP validation."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError

from hypequery.datasets import (
    CachedRows,
    Dataset,
    DatasetQuery,
    MemoryCacheStore,
    ResultCache,
    create_dataset_client,
    dimension,
    eq,
    measure,
    plan_dataset_query,
)
from hypequery.datasets.client.results import ResultRows
from hypequery.datasets.planner import CompiledQuery
from hypequery.datasets.utils.query_timezone import time_filter_value, timezone_identity
from hypequery.serve.models import QueryRequest


def dataset() -> Dataset:
    return Dataset(
        name="events",
        source="test_db.beta_timezone",
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
    with pytest.raises(ValidationError):
        QueryRequest.model_validate({"timezone": zone})


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


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ, reason="live ClickHouse required"
)
def test_live_zone_buckets_and_filters_match_raw_sql() -> None:
    import clickhouse_connect

    from hypequery.execution import ClickHouseConnection, create_clickhouse_executor
    from hypequery.execution.results import DriverResult, decode_result

    connection = ClickHouseConnection(
        host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
        port=int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123")),
        database="test_db",
        username="default",
        password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
    )
    admin = clickhouse_connect.get_client(
        host=connection.host,
        port=connection.port,
        username=connection.username,
        password=connection.password,
        database="test_db",
    )
    executor = create_clickhouse_executor(connection)
    try:
        admin.command("DROP TABLE IF EXISTS beta_timezone")
        admin.command(
            "CREATE TABLE beta_timezone "
            "(occurred_at DateTime64(3, 'America/New_York')) ENGINE=Memory"
        )
        admin.command(
            "INSERT INTO beta_timezone VALUES ('2026-03-07 23:30:00'), "
            "('2026-03-08 01:30:00'), ('2026-03-08 03:30:00')"
        )
        client = create_dataset_client(executor=executor)
        for zone in ("UTC", "America/New_York", "America/Los_Angeles"):
            actual = client.execute(dataset(), {"by": "day", "timezone": zone})
            raw = admin.query(
                "SELECT toStartOfDay(toDateTime64(occurred_at, 9, {zone:String})) "
                "AS period, count(occurred_at) AS rows FROM beta_timezone "
                "GROUP BY period ORDER BY period",
                parameters={"zone": zone},
                tz_mode="aware",
            )
            # Drivers normalize DateTime results; compare instants and aggregate values.
            assert (
                actual.data == decode_result(cast(DriverResult, raw), "ground-truth").named_rows()
            )
        filtered = client.execute(
            dataset(),
            {
                "measures": ["rows"],
                "timezone": "America/New_York",
                "filters": [eq("at", "2026-03-08T01:30:00")],
            },
        )
        assert filtered.data[0]["rows"] == 1
    finally:
        executor.close()
        admin.command("DROP TABLE IF EXISTS beta_timezone")
        admin.close()


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

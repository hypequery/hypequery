"""Live parameter matrix; CI supplies a ClickHouse service."""

from __future__ import annotations

import asyncio
import os
import threading
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from hypequery.datasets import (
    Dataset,
    DatasetQuery,
    MemoryCacheStore,
    ResultCache,
    count,
    create_async_dataset_client,
    create_dataset_client,
    dimension,
    eq,
    measure,
)
from hypequery.datasets.planner import CompiledQuery, CompiledQueryError, Deadline, TypedParameter
from hypequery.execution import (
    ClickHouseConnection,
    ReadonlyPolicy,
    create_async_clickhouse_executor,
    create_clickhouse_executor,
)
from hypequery.serve import (
    HttpSecurity,
    Principal,
    ProductionProfile,
    add_dataset_endpoint,
    create_app,
    create_router,
)


def _connection() -> ClickHouseConnection:
    return ClickHouseConnection(
        host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
        port=int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123")),
        database="test_db",
        username="default",
        password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
    )


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
def test_live_production_http_dataset() -> None:
    """The bounded HTTP path reaches the actual driver/database in both CI versions."""
    dataset = Dataset(
        name="one",
        source="system.one",
        dimensions={"dummy": dimension("number")},
        measures={"rows": measure(count("dummy"))},
    )
    executor = create_clickhouse_executor(_connection())
    router = create_router(authenticate=lambda credential: Principal(subject="reader"))
    add_dataset_endpoint(
        router, "/query", dataset=dataset, client=create_dataset_client(executor=executor)
    )
    try:
        app = create_app(
            router,
            security=HttpSecurity(allowed_hosts=("testserver",)),
            production=ProductionProfile(max_result_rows=3, max_result_bytes=1024),
        )
        with TestClient(app) as http:
            response = http.post(
                "/query",
                headers={"Authorization": "Bearer test"},
                json={"measures": ["rows"], "limit": 100, "includeMeta": True},
            )
            assert response.status_code == 200, response.text
            assert response.json()["data"] == [{"rows": "1"}]
            assert response.json()["meta"]["pagination"] == {
                "limit": 2,
                "offset": 0,
                "hasMore": False,
            }
    finally:
        executor.close()


def _query(value: object, kind: str) -> CompiledQuery:
    return CompiledQuery(
        sql="SELECT {p0:" + kind + "} AS value",
        parameters={"p0": TypedParameter("p0", kind, value)},
    )


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
@pytest.mark.parametrize(
    ("value", "kind", "expected"),
    [
        ("quote ' and \\ and \x00", "String", "quote ' and \\ and \x00"),
        (2**63 - 1, "Int64", 2**63 - 1),
        (2**64 - 1, "UInt64", 2**64 - 1),
        (Decimal("123456789.012345678"), "Decimal(27,9)", "123456789.012345678"),
        (
            datetime(2026, 10, 25, 1, 30, tzinfo=UTC),
            "DateTime64(3)",
            "2026-10-25T01:30:00+00:00",
        ),
        # RFC 3339 text, the JSON form of a timestamp filter, inside the hour a
        # European daylight-saving change repeats.
        ("2026-10-25T01:30:00Z", "DateTime64(3)", "2026-10-25T01:30:00+00:00"),
        ("2026-10-25T02:30:00+01:00", "DateTime64(3)", "2026-10-25T01:30:00+00:00"),
    ],
)
def test_live_sync_parameters(value: object, kind: str, expected: object) -> None:
    executor = create_clickhouse_executor(_connection())
    result = executor.execute(_query(value, kind))
    assert result.rows == ((expected,),)


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
def test_live_timestamp_array_parameters() -> None:
    # Each element of a timestamp array is bound as Unix seconds, so offsets
    # and the repeated daylight-saving hour survive serialization intact.
    executor = create_clickhouse_executor(_connection())
    query = CompiledQuery(
        sql=(
            "SELECT arrayStringConcat(arrayMap(x -> toString(x, 'UTC'),"
            " {p0:Array(DateTime64(3))}), ',') AS value"
        ),
        parameters={
            "p0": TypedParameter(
                "p0",
                "Array(DateTime64(3))",
                [
                    "2026-10-25T01:30:00Z",
                    "2026-10-25T02:30:00.250+01:00",
                    datetime(2026, 10, 25, 1, 30, tzinfo=UTC),
                ],
            )
        },
    )
    assert executor.execute(query).rows == (
        ("2026-10-25 01:30:00.000,2026-10-25 01:30:00.250,2026-10-25 01:30:00.000",),
    )


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
def test_live_async_parameters() -> None:
    async def run() -> object:
        executor = await create_async_clickhouse_executor(_connection())
        try:
            return (await executor.execute(_query("async ' \x00", "String"))).rows
        finally:
            await executor.aclose()

    assert asyncio.run(run()) == (("async ' \x00",),)


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
@pytest.mark.parametrize("cancel_by", ["signal", "deadline"])
def test_live_async_cancellation_stops_server_query(cancel_by: str) -> None:
    async def run() -> None:
        connection = _connection()
        executor = await create_async_clickhouse_executor(connection)
        observer = await create_async_clickhouse_executor(connection)
        signal = threading.Event()
        compiled = CompiledQuery(
            "SELECT sleep(3) AS value",
            {},
            deadline=Deadline.after(0.5 if cancel_by == "deadline" else 10),
            cancellation=signal,
        )
        try:
            task = asyncio.create_task(executor.execute(compiled))
            active = CompiledQuery(
                "SELECT count() AS value FROM system.processes WHERE query_id = {p0:String}",
                {"p0": TypedParameter("p0", "String", compiled.query_id)},
            )
            for _ in range(100):
                if (await observer.execute(active)).rows == ((1,),):
                    break
                await asyncio.sleep(0.02)
            else:
                pytest.fail("query did not appear in system.processes")
            if cancel_by == "signal":
                signal.set()
            with pytest.raises(CompiledQueryError) as exc:
                await task
            assert exc.value.category == (
                "aborted" if cancel_by == "signal" else "deadline-exceeded"
            )
            assert (await observer.execute(active)).rows == ((0,),)
        finally:
            await executor.aclose()
            await observer.aclose()

    asyncio.run(run())


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
def test_live_dataset_clients_return_the_same_rows() -> None:
    one = Dataset(
        name="one",
        source="system.one",
        dimensions={"dummy": dimension("number")},
        measures={"rows": measure(count("dummy"))},
    )
    query = DatasetQuery(dimensions=("dummy",), measures=("rows",), filters=(eq("dummy", 0),))
    expected = ({"dummy": 0, "rows": 1},)

    executor = create_clickhouse_executor(_connection())
    try:
        assert create_dataset_client(executor=executor).execute(one, query).data == expected
        cache = ResultCache(
            store=MemoryCacheStore(),
            project="live",
            environment="ci",
            ttl_seconds=60,
        )
        cached = create_dataset_client(executor=executor, cache=cache)
        first, second = cached.execute(one, query), cached.execute(one, query)
        assert (first.meta.cache, second.meta.cache) == ("miss", "hit")
        assert first.data == second.data == expected
    finally:
        executor.close()

    async def run() -> object:
        async_executor = await create_async_clickhouse_executor(_connection())
        try:
            client = create_async_dataset_client(executor=async_executor)
            return (await client.execute(one, query)).data
        finally:
            await async_executor.aclose()

    assert asyncio.run(run()) == expected


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
@pytest.mark.parametrize(
    ("level", "matching_limits", "policy", "succeeds"),
    [
        (1, False, "query", False),
        (1, False, "profile", False),
        (1, True, "query", True),
        (1, True, "profile", True),
        (2, False, "query", True),
        (2, False, "profile", True),
    ],
)
def test_live_readonly_users_respect_explicit_policy(
    level: int, matching_limits: bool, policy: ReadonlyPolicy, succeeds: bool
) -> None:
    # A strict readonly = 1 profile must carry the planner's exact limits, so
    # missing limits still fail. A readonly = 2 user works in either mode: the
    # executor leaves out only the readonly setting it may not change.
    from clickhouse_connect import get_client

    connection = _connection()
    username = f"hypequery_readonly_{level}_{int(matching_limits)}"
    password = f"{connection.password}_readonly_{level}_{int(matching_limits)}"
    admin = get_client(
        host=connection.host,
        port=connection.port,
        username=connection.username,
        password=connection.password,
    )
    try:
        admin.command(f"DROP USER IF EXISTS {username}")
        profile = f"readonly = {level}"
        if matching_limits:
            profile += (
                ", max_execution_time = 30, max_result_rows = 100000, "
                "max_result_bytes = 67108864, max_threads = 4"
            )
        admin.command(f"CREATE USER {username} IDENTIFIED BY '{password}' SETTINGS {profile}")
        admin.command(f"GRANT SELECT ON {connection.database}.* TO {username}")
        reader_connection = replace(
            connection, username=username, password=password, readonly_policy=policy
        )
        reader = create_clickhouse_executor(reader_connection)
        try:
            if succeeds:
                assert reader.execute(_query(7, "Int64")).rows == ((7,),)
            else:
                with pytest.raises(CompiledQueryError):
                    reader.execute(_query(7, "Int64"))
        finally:
            reader.close()

        async def run_async() -> tuple[tuple[object, ...], ...]:
            async_reader = await create_async_clickhouse_executor(reader_connection)
            try:
                return (await async_reader.execute(_query(8, "Int64"))).rows
            finally:
                await async_reader.aclose()

        if succeeds:
            assert asyncio.run(run_async()) == ((8,),)
        else:
            with pytest.raises(CompiledQueryError):
                asyncio.run(run_async())
    finally:
        admin.command(f"DROP USER IF EXISTS {username}")
        admin.close()


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
def test_live_profile_policy_rejects_unrestricted_user() -> None:
    connection = replace(_connection(), readonly_policy="profile")
    reader = create_clickhouse_executor(connection)
    try:
        with pytest.raises(CompiledQueryError) as exc:
            reader.execute(_query(1, "Int64"))
        assert exc.value.category == "forbidden"
    finally:
        reader.close()

    async def run_async() -> None:
        async_reader = await create_async_clickhouse_executor(connection)
        try:
            with pytest.raises(CompiledQueryError) as exc:
                await async_reader.execute(_query(1, "Int64"))
            assert exc.value.category == "forbidden"
        finally:
            await async_reader.aclose()

    asyncio.run(run_async())


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
@pytest.mark.parametrize("cancel_by", ["signal", "deadline"])
def test_live_sync_cancellation_stops_server_query(cancel_by: str) -> None:
    import time
    from concurrent.futures import ThreadPoolExecutor

    executor = create_clickhouse_executor(_connection())
    observer = create_clickhouse_executor(_connection())
    signal = threading.Event()
    compiled = CompiledQuery(
        "SELECT sleep(3) AS value",
        {},
        deadline=Deadline.after(0.5 if cancel_by == "deadline" else 10),
        cancellation=signal,
    )
    active = CompiledQuery(
        "SELECT count() AS value FROM system.processes WHERE query_id = {p0:String}",
        {"p0": TypedParameter("p0", "String", compiled.query_id)},
    )
    try:
        with ThreadPoolExecutor(max_workers=1) as workers:
            task = workers.submit(executor.execute, compiled)
            for _ in range(100):
                if observer.execute(active).rows == ((1,),):
                    break
                time.sleep(0.02)
            else:
                pytest.fail("query did not appear in system.processes")
            if cancel_by == "signal":
                signal.set()
            with pytest.raises(CompiledQueryError) as exc:
                task.result(timeout=5)
            assert exc.value.category == (
                "aborted" if cancel_by == "signal" else "deadline-exceeded"
            )
            assert observer.execute(active).rows == ((0,),)
    finally:
        executor.close()
        observer.close()

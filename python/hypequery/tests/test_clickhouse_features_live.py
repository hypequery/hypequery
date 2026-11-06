"""Ported ClickHouse features against a live server, compared with hand-written SQL."""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest

from hypequery.datasets import (
    DatasetQuery,
    FilterDefinition,
    belongs_to,
    create_dataset_client,
    create_dataset_registry,
    dataset,
    dimension,
    filter,  # noqa: A004
    measure,
    resolved_rows,
    segment,
)
from hypequery.datasets.formulas import divide, null_if_zero
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

pytestmark = pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)

DATABASE = "hq_feature_port"
PORT = int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123"))

customers = dataset(
    "customers",
    source="customers",
    dimensions={
        "plan": dimension.string(),
        "trial": dimension.boolean(),
        "churnedAt": dimension.timestamp(column="churned_at"),
    },
    measures={
        "customers": measure.count("plan"),
        "churned": measure.count("plan", filters=(filter.is_not_null("churnedAt"),)),
    },
    filters={
        "churnedAt": FilterDefinition(field="churnedAt", operators=("gte", "isNull", "isNotNull")),
        "trial": FilterDefinition(field="trial", operators=("eq", "isNull")),
    },
)


@pytest.fixture(scope="module")
def admin() -> Iterator[object]:
    import clickhouse_connect

    client = clickhouse_connect.get_client(
        host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
        port=PORT,
        username="default",
        password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
    )
    client.command(f"DROP DATABASE IF EXISTS {DATABASE}")
    client.command(f"CREATE DATABASE {DATABASE}")
    client.command(
        f"CREATE TABLE {DATABASE}.customers (plan String, trial Nullable(Bool), "
        "churned_at Nullable(DateTime64(3, 'UTC'))) ENGINE = Memory"
    )
    client.command(
        "INSERT INTO hq_feature_port.customers VALUES "
        "('pro', true, '2026-02-01 00:00:00'), ('pro', NULL, NULL), "
        "('free', false, NULL), ('free', NULL, '1969-07-20 20:17:00')"
    )
    client.command(
        "CREATE TABLE hq_feature_port.visits (user_id UInt64, kind String) ENGINE = Memory"
    )
    # 200,000 distinct users: well past where uniq stops being exact.
    client.command(
        "INSERT INTO hq_feature_port.visits SELECT number, "
        "if(number % 3 = 0, 'purchase', 'view') FROM numbers(200000)"
    )
    # An AggregatingMergeTree a materialized view would feed: one state per day
    # and region, written in three parts that merges have not yet combined.
    client.command(
        "CREATE TABLE hq_feature_port.daily_users (day Date, region String, "
        "users AggregateFunction(uniq, UInt64), events AggregateFunction(count), "
        "revenue AggregateFunction(sum, Float64)) "
        "ENGINE = AggregatingMergeTree ORDER BY (day, region)"
    )
    client.command("SYSTEM STOP MERGES hq_feature_port.daily_users")
    for offset in ("0", "10000", "20000"):
        client.command(
            "INSERT INTO hq_feature_port.daily_users SELECT toDate('2026-01-01') + number % 7, "
            "if(number % 2 = 0, 'EU', 'US'), uniqState(toUInt64(number % 5000)), countState(), "
            "sumState(toFloat64(number % 100)) FROM numbers({offset:UInt64}, 10000) "
            "GROUP BY 1, 2",
            parameters={"offset": offset},
        )
    # Row versions merges have not yet removed: u1 moved from free to pro,
    # u2 was soft-deleted, u3 has one version. Merges stay stopped so FINAL
    # does the work at query time.
    client.command(
        "CREATE TABLE hq_feature_port.accounts (id String, plan String, is_deleted UInt8, "
        "version UInt32) ENGINE = ReplacingMergeTree(version) ORDER BY id"
    )
    client.command("SYSTEM STOP MERGES hq_feature_port.accounts")
    client.command(
        "INSERT INTO hq_feature_port.accounts VALUES ('u1', 'free', 0, 1), ('u2', 'free', 0, 1), "
        "('u3', 'pro', 0, 1)"
    )
    client.command(
        "INSERT INTO hq_feature_port.accounts VALUES ('u1', 'pro', 0, 2), ('u2', 'free', 1, 2)"
    )
    client.command(
        "CREATE TABLE hq_feature_port.logins (account_id String, n UInt32) ENGINE = Memory"
    )
    client.command(
        "INSERT INTO hq_feature_port.logins VALUES ('u1', 1), ('u1', 2), ('u2', 3), ('u3', 4)"
    )
    client.command(
        "CREATE TABLE hq_feature_port.balances (id String, amount Int64, sign Int8) "
        "ENGINE = CollapsingMergeTree(sign) ORDER BY id"
    )
    client.command("SYSTEM STOP MERGES hq_feature_port.balances")
    client.command("INSERT INTO hq_feature_port.balances VALUES ('a', 10, 1), ('b', 5, 1)")
    # a's 10 is cancelled and replaced by 30; b's cancel row has no match yet.
    client.command(
        "INSERT INTO hq_feature_port.balances VALUES ('a', 10, -1), ('a', 30, 1), ('c', 7, -1)"
    )
    client.command(
        "CREATE TABLE hq_feature_port.vbalances (id String, amount Int64, sign Int8, "
        "version UInt32) ENGINE = VersionedCollapsingMergeTree(sign, version) ORDER BY id"
    )
    client.command("SYSTEM STOP MERGES hq_feature_port.vbalances")
    client.command("INSERT INTO hq_feature_port.vbalances VALUES ('a', 10, 1, 1)")
    client.command("INSERT INTO hq_feature_port.vbalances VALUES ('a', 10, -1, 1), ('a', 25, 1, 2)")
    # 40 days of sales: 'web' every day, 'store' only on even days, so the
    # skeleton must fill store's gaps; one sale lands at 23:30 UTC, which is the
    # next day in Europe/Berlin.
    client.command(
        "CREATE TABLE hq_feature_port.sales (sold_at DateTime64(3, 'UTC'), channel String, "
        "amount Float64) ENGINE = Memory"
    )
    client.command(
        "INSERT INTO hq_feature_port.sales SELECT toDateTime64('2026-01-01 10:00:00', 3, 'UTC') "
        "+ toIntervalDay(number), 'web', number % 7 + 1 FROM numbers(40)"
    )
    client.command(
        "INSERT INTO hq_feature_port.sales SELECT toDateTime64('2026-01-01 12:00:00', 3, 'UTC') "
        "+ toIntervalDay(number * 2), 'store', 10 FROM numbers(20)"
    )
    client.command("INSERT INTO hq_feature_port.sales VALUES ('2026-01-20 23:30:00', 'web', 100)")
    yield client
    client.command(f"DROP DATABASE IF EXISTS {DATABASE}")


@pytest.fixture(scope="module")
def executor(admin: object) -> Iterator[object]:
    executor = create_clickhouse_executor(
        ClickHouseConnection(
            host=os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"],
            port=PORT,
            database=DATABASE,
            username="default",
            password=os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"],
        )
    )
    yield executor
    executor.close()


@pytest.fixture(scope="module")
def client(executor: object) -> object:
    return create_dataset_client(executor=executor)  # type: ignore[arg-type]


def _truth(admin: object, sql: str) -> list[tuple[object, ...]]:
    return [tuple(row) for row in admin.query(sql).result_rows]  # type: ignore[attr-defined]


def _rows(client: object, query: DatasetQuery) -> list[tuple[object, ...]]:
    result = client.execute(customers, query)  # type: ignore[attr-defined]
    return [tuple(row.values()) for row in result.data]


def test_null_checks_match_is_null_including_a_pre_1971_date(admin: object, client: object) -> None:
    # A sentinel range such as churned_at >= '1971-01-01' would miss the 1969 row.
    query = DatasetQuery(
        dimensions=("plan",),
        measures=("customers", "churned"),
        filters=(filter.is_null("trial"),),
        order_by=(),
    )
    expected = _truth(
        admin,
        "SELECT plan, count(plan), countIf(plan, churned_at IS NOT NULL) "
        "FROM hq_feature_port.customers WHERE trial IS NULL GROUP BY plan ORDER BY plan",
    )
    actual = sorted(_rows(client, query), key=str)
    assert [tuple(str(value) for value in row) for row in actual] == [
        tuple(str(value) for value in row) for row in expected
    ]
    churned = _rows(
        client,
        DatasetQuery(measures=("customers",), filters=(filter.is_not_null("churnedAt"),)),
    )
    assert str(churned[0][0]) == "2"


visits = dataset(
    "visits",
    source="visits",
    dimensions={"userId": dimension.number(column="user_id"), "kind": dimension.string()},
    measures={
        "visitors": measure.count_distinct("userId"),
        "estimatedVisitors": measure.approx_count_distinct("userId"),
        "estimatedBuyers": measure.approx_count_distinct(
            "userId", filters=(filter.eq("kind", "purchase"),)
        ),
    },
)


def test_approx_count_distinct_is_uniq_and_count_distinct_stays_exact(
    admin: object, client: object
) -> None:
    result = client.execute(  # type: ignore[attr-defined]
        visits, DatasetQuery(measures=("visitors", "estimatedVisitors", "estimatedBuyers"))
    )
    row = result.data[0]
    truth = _truth(
        admin,
        "SELECT uniqExact(user_id), uniq(user_id), uniqIf(user_id, kind = 'purchase') "
        "FROM hq_feature_port.visits",
    )[0]
    assert [str(row["visitors"]), str(row["estimatedVisitors"]), str(row["estimatedBuyers"])] == [
        str(value) for value in truth
    ]
    assert str(row["visitors"]) == "200000"


daily_users = dataset(
    "dailyUsers",
    source="daily_users",
    time_key="day",
    dimensions={"day": dimension.timestamp(), "region": dimension.string()},
    measures={
        "activeUsers": measure.merge("uniq", "users"),
        "events": measure.merge("count", "events"),
        "revenue": measure.merge("sum", "revenue"),
    },
)


def test_merge_measures_finalize_states_across_unmerged_parts(
    admin: object, client: object
) -> None:
    result = client.execute(  # type: ignore[attr-defined]
        daily_users,
        DatasetQuery(
            dimensions=("region",),
            measures=("activeUsers", "events", "revenue"),
            order_by=(),
        ),
    )
    actual = sorted(
        (row["region"], str(row["activeUsers"]), str(row["events"]), str(row["revenue"]))
        for row in result.data
    )
    expected = _truth(
        admin,
        "SELECT region, uniqMerge(users), countMerge(events), sumMerge(revenue) "
        "FROM hq_feature_port.daily_users GROUP BY region ORDER BY region",
    )
    assert actual == [tuple(str(value) for value in row) for row in expected]
    # Counting the state rows instead (the trap) gives a different, meaningless number.
    rows = _truth(admin, "SELECT count() FROM hq_feature_port.daily_users")[0][0]
    assert str(rows) != str(expected[0][2])


accounts = dataset(
    "accounts",
    source="accounts",
    dimensions={"id": dimension.string(), "plan": dimension.string()},
    measures={"accounts": measure.count("id")},
    row_resolution=resolved_rows.replacing(deleted_column="is_deleted"),
)
logins = dataset(
    "logins",
    source="logins",
    dimensions={"accountId": dimension.string(column="account_id")},
    measures={"logins": measure.count("account_id")},
    relationships={"account": belongs_to(accounts, from_field="account_id", to_field="id")},
)


def _strings(rows: object) -> list[tuple[str, ...]]:
    return sorted(tuple(str(value) for value in row) for row in rows)  # type: ignore[attr-defined]


def test_final_counts_current_versions_only(admin: object, client: object) -> None:
    result = client.execute(  # type: ignore[attr-defined]
        accounts, DatasetQuery(dimensions=("plan",), measures=("accounts",))
    )
    expected = _truth(
        admin,
        "SELECT plan, count(id) FROM hq_feature_port.accounts FINAL WHERE is_deleted = 0 "
        "GROUP BY plan",
    )
    assert _strings(tuple(row.values()) for row in result.data) == _strings(expected)
    # The physical table still holds five versions: a plain read counts them all.
    assert _truth(admin, "SELECT count() FROM hq_feature_port.accounts")[0][0] == 5
    assert _strings(expected) == [("pro", "2")]


def test_a_filter_never_matches_a_superseded_version(admin: object, client: object) -> None:
    result = client.execute(  # type: ignore[attr-defined]
        accounts,
        DatasetQuery(measures=("accounts",), filters=(filter.eq("plan", "free"),)),
    )
    # u1 was free in version 1 and u2 is deleted: no current account is free.
    assert str(result.data[0]["accounts"]) == "0"


def test_a_joined_target_is_resolved_before_the_join(admin: object, executor: object) -> None:
    registry = create_dataset_registry(accounts, logins)
    with_registry = create_dataset_client(executor=executor, registry=registry)  # type: ignore[arg-type]
    result = with_registry.execute(
        logins, DatasetQuery(dimensions=("account.plan",), measures=("logins",))
    )
    expected = _truth(
        admin,
        "SELECT a.plan, count(l.account_id) FROM hq_feature_port.logins AS l LEFT ANY JOIN "
        "(SELECT id, plan FROM hq_feature_port.accounts FINAL WHERE is_deleted = 0) AS a "
        "ON l.account_id = a.id GROUP BY a.plan",
    )
    actual = [
        ("None" if row["account.plan"] is None else row["account.plan"], str(row["logins"]))
        for row in result.data
    ]
    assert sorted(actual) == sorted(
        ("None" if plan == "" else plan, str(count)) for plan, count in expected
    )


_COLLAPSED = {
    "balances": "SELECT id, sum(amount), count(id) FROM hq_feature_port.balances FINAL "
    "WHERE sign = 1 GROUP BY id",
    "vbalances": "SELECT id, sum(amount), count(id) FROM hq_feature_port.vbalances FINAL "
    "WHERE sign = 1 GROUP BY id",
}


@pytest.mark.parametrize(
    ("source", "policy"),
    [
        ("balances", resolved_rows.collapsing(sign_column="sign")),
        ("vbalances", resolved_rows.versioned_collapsing(sign_column="sign")),
    ],
)
def test_collapsing_engines_keep_surviving_positive_rows(
    admin: object, client: object, source: str, policy: object
) -> None:
    balances = dataset(
        source,
        source=source,
        dimensions={"id": dimension.string()},
        measures={"total": measure.sum("amount"), "rows": measure.count("id")},
        row_resolution=policy,  # type: ignore[arg-type]
    )
    result = client.execute(  # type: ignore[attr-defined]
        balances, DatasetQuery(dimensions=("id",), measures=("total", "rows"))
    )
    expected = _truth(admin, _COLLAPSED[source])
    assert _strings(tuple(row.values()) for row in result.data) == _strings(expected)


def test_a_segment_matches_its_hand_written_predicate(admin: object, client: object) -> None:
    churned_pros = dataset(
        "customers",
        source="customers",
        dimensions=dict(customers.dimensions),
        measures={"customers": measure.count("plan")},
        segments={"churnedPro": segment(filter.eq("plan", "pro"), filter.is_not_null("churnedAt"))},
    )
    result = client.execute(  # type: ignore[attr-defined]
        churned_pros, DatasetQuery(measures=("customers",), segments=("churnedPro",))
    )
    expected = _truth(
        admin,
        "SELECT count(plan) FROM hq_feature_port.customers "
        "WHERE plan = 'pro' AND churned_at IS NOT NULL",
    )
    assert str(result.data[0]["customers"]) == str(expected[0][0]) == "1"


sales = dataset(
    "sales",
    source="sales",
    time_key="sold_at",
    dimensions={"channel": dimension.string(), "soldAt": dimension.timestamp(column="sold_at")},
    measures={
        "revenue": measure.sum("amount"),
        "sales": measure.count("amount"),
        "rolling7": measure.trailing("revenue", 7, "day"),
        "monthToDate": measure.to_date("revenue", "month"),
        "runningSales": measure.cumulative("sales"),
        "runningRevenue": measure.cumulative("revenue"),
        "lastWeek": measure.shift("revenue", 7, "day"),
        "lastMonth": measure.shift("revenue", 1, "month"),
        "weekOverWeek": measure.derived(divide("revenue", null_if_zero("lastWeek"))),
    },
)
FEB = (filter.gte("soldAt", "2026-02-01"), filter.lt("soldAt", "2026-02-10"))
# Hand-written truth: one row per day of the range, aggregates over the window.
_DAYS = "SELECT toDate('2026-02-01') + number AS d FROM numbers(9)"


def _by_day(client: object, measures: tuple[str, ...], **options: object) -> list[tuple[str, ...]]:
    query = DatasetQuery(measures=measures, by="day", filters=FEB, **options)  # type: ignore[arg-type]
    result = client.execute(sales, query)  # type: ignore[attr-defined]
    return [tuple(str(row[k]) for k in row) for row in result.data]


def _truth_by_day(admin: object, expression: str) -> list[tuple[str, ...]]:
    sql = (
        f"SELECT toString(toDateTime(d)), {expression} "  # noqa: S608 - test-authored SQL
        f"FROM ({_DAYS}) AS days CROSS JOIN hq_feature_port.sales GROUP BY d ORDER BY d"
    )
    return [tuple(str(value) for value in row) for row in _truth(admin, sql)]


def _number(text: str) -> str:
    return "None" if text in ("None", "nan") else str(float(text))


def _normalized(rows: list[tuple[str, ...]]) -> list[tuple[str, ...]]:
    return [(row[0][:10], *(_number(value) for value in row[1:])) for row in rows]


def test_trailing_to_date_and_cumulative_windows_match_sql(admin: object, client: object) -> None:
    actual = _by_day(client, ("revenue", "rolling7", "monthToDate", "runningSales"))
    expected = _truth_by_day(
        admin,
        "sumIf(amount, toDate(sold_at) = d), "
        "sumIf(amount, toDate(sold_at) BETWEEN d - 6 AND d), "
        "sumIf(amount, toDate(sold_at) BETWEEN toStartOfMonth(d) AND d), "
        "countIf(toDate(sold_at) <= d)",
    )
    assert _normalized(actual) == _normalized(expected)


def test_shifts_and_a_formula_over_them_match_sql(admin: object, client: object) -> None:
    actual = _by_day(client, ("revenue", "lastWeek", "lastMonth", "weekOverWeek"))
    expected = _truth_by_day(
        admin,
        "sumIf(amount, toDate(sold_at) = d), "
        "sumIf(amount, toDate(sold_at) = d - 7), "
        "sumIf(amount, toDate(sold_at) = d - toIntervalMonth(1)), "
        "sumIf(amount, toDate(sold_at) = d) / nullIf(sumIf(amount, toDate(sold_at) = d - 7), 0)",
    )
    assert _normalized(actual) == _normalized(expected)


def test_windows_fill_every_bucket_for_every_dimension(admin: object, client: object) -> None:
    result = client.execute(  # type: ignore[attr-defined]
        sales,
        DatasetQuery(
            dimensions=("channel",), measures=("sales", "rolling7"), by="day", filters=FEB
        ),
    )
    store = [row for row in result.data if row["channel"] == "store"]
    # 9 days for each channel, store's missing days included: counts 0, sums NULL.
    assert len(result.data) == 18
    assert len(store) == 9
    assert {str(row["sales"]) for row in store} == {"0", "1"}
    store_sql = (
        "SELECT d, sumIf(amount, channel = 'store' AND toDate(sold_at) BETWEEN d - 6 AND d) "  # noqa: S608 - test-authored SQL
        f"FROM ({_DAYS}) AS days CROSS JOIN hq_feature_port.sales "
        "GROUP BY d ORDER BY d"
    )
    expected = _truth(admin, store_sql)
    assert [_number(str(row["rolling7"])) for row in store] == [
        _number(str(value)) for _, value in expected
    ]


def test_windows_bucket_in_the_query_timezone(admin: object, client: object) -> None:
    january = (filter.gte("soldAt", "2026-01-20"), filter.lt("soldAt", "2026-01-23"))
    result = client.execute(  # type: ignore[attr-defined]
        sales,
        DatasetQuery(
            measures=("revenue", "rolling7"), by="day", filters=january, timezone="Europe/Berlin"
        ),
    )
    expected = _truth(
        admin,
        "SELECT d, sumIf(amount, toDate(sold_at, 'Europe/Berlin') = d), "
        "sumIf(amount, toDate(sold_at, 'Europe/Berlin') BETWEEN d - 6 AND d) "
        "FROM (SELECT toDate('2026-01-20') + number AS d FROM numbers(3)) AS days "
        "CROSS JOIN hq_feature_port.sales GROUP BY d ORDER BY d",
    )
    actual = [
        (row["period"][:10], _number(str(row["revenue"])), _number(str(row["rolling7"])))
        for row in result.data
    ]
    assert actual == [(str(d), _number(str(a)), _number(str(b))) for d, a, b in expected]


def test_to_date_starts_at_the_local_calendar_boundary(admin: object, client: object) -> None:
    # Web sales land at 10:00 UTC, which is local midnight of the next day in
    # Kiritimati (UTC+14); a UTC month boundary would drop 1 February's sale.
    zone = "Pacific/Kiritimati"
    february = (filter.gte("soldAt", "2026-02-01"), filter.lt("soldAt", "2026-02-04"))
    result = client.execute(  # type: ignore[attr-defined]
        sales, DatasetQuery(measures=("monthToDate",), by="day", filters=february, timezone=zone)
    )
    expected = _truth(
        admin,
        f"SELECT d, sumIf(amount, toStartOfMonth(sold_at, '{zone}') = toStartOfMonth(d) "  # noqa: S608 - test-authored SQL
        f"AND toDate(sold_at, '{zone}') <= d) "
        "FROM (SELECT toDate('2026-02-01') + number AS d FROM numbers(3)) AS days "
        "CROSS JOIN hq_feature_port.sales GROUP BY d ORDER BY d",
    )
    actual = [(row["period"][:10], _number(str(row["monthToDate"]))) for row in result.data]
    assert actual == [(str(d), _number(str(total))) for d, total in expected]
    assert float(actual[0][1]) > 0


def test_an_unbounded_window_query_is_refused(client: object) -> None:
    from hypequery.datasets.planner import CompiledQueryError

    with pytest.raises(CompiledQueryError, match="bounded time range"):
        client.execute(sales, DatasetQuery(measures=("rolling7",), by="day"))  # type: ignore[attr-defined]

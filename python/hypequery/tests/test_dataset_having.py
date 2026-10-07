"""Having conditions on aggregated measure values (HQ-329 parity)."""

from __future__ import annotations

import os
import re
import secrets
from dataclasses import dataclass, field

import pytest
from fastapi.testclient import TestClient

from hypequery.datasets import (
    CompiledQuery,
    Dataset,
    DatasetLimits,
    DatasetQuery,
    belongs_to,
    count,
    create_dataset_client,
    create_dataset_registry,
    desc,
    dimension,
    eq,
    max,  # noqa: A004
    measure,
)
from hypequery.datasets import sum as sum_
from hypequery.datasets.cache import MemoryCacheStore, ResultCache
from hypequery.datasets.client import ResultScalar
from hypequery.datasets.planner import CompiledQueryError, plan_dataset_query
from hypequery.serve import (
    Credential,
    HttpSecurity,
    Principal,
    add_dataset_endpoint,
    add_metric_endpoint,
    create_app,
    create_router,
)

Orders = Dataset(
    name="orders",
    source="orders",
    dimensions={
        "customerId": dimension("string", column="customer_id"),
        "amount": dimension("number"),
        "status": dimension("string"),
    },
    measures={
        "revenue": measure(sum_("amount")),
        "paidRevenue": measure(sum_("amount"), filters=(eq("status", "paid"),)),
        "orders": measure(count("customerId")),
    },
    limits=DatasetLimits(max_filters=2),
)


def _plan(**query: object) -> CompiledQuery:
    return plan_dataset_query(Orders, DatasetQuery.model_validate(query))


def _error(**query: object) -> str:
    with pytest.raises(CompiledQueryError) as raised:
        _plan(**query)
    return str(raised.value)


def test_conditions_read_the_aggregate_expression_after_grouping() -> None:
    compiled = _plan(
        dimensions=("customerId",),
        measures=("revenue", "paidRevenue"),
        having=(
            {"measure": "revenue", "operator": "gt", "value": 10_000},
            {"measure": "paidRevenue", "operator": "between", "value": [1, 5.5]},
        ),
        order_by=(desc("revenue"),),
        limit=10,
    )
    assert re.search(
        r"GROUP BY `customerId` HAVING sum\(`amount`\) > \{p(\d+):Float64\} AND "
        r"sumIf\(`amount`, `status` = \{p0:String\}\) BETWEEN \{p\d+:Float64\} AND "
        r"\{p\d+:Float64\} ORDER BY `revenue` DESC LIMIT 10\Z",
        compiled.sql,
    )
    values = [parameter.value for parameter in compiled.parameters.values()]
    assert values == ["paid", 10_000, 1, 5.5]
    assert "10000" not in compiled.sql


@pytest.mark.parametrize(
    ("operator", "value", "fragment"),
    [
        ("eq", 3, "= {p0:Float64}"),
        ("neq", 3, "!= {p0:Float64}"),
        ("gte", 3, ">= {p0:Float64}"),
        ("lt", 3, "< {p0:Float64}"),
        ("lte", 3.5, "<= {p0:Float64}"),
        ("in", [1, 2], "IN {p0:Array(Float64)}"),
        ("notIn", [1], "NOT IN {p0:Array(Float64)}"),
    ],
)
def test_every_operator_binds_its_values(operator: str, value: object, fragment: str) -> None:
    compiled = _plan(
        measures=("orders",), having=({"measure": "orders", "operator": operator, "value": value},)
    )
    assert f"HAVING count(`customer_id`) {fragment}" in compiled.sql


def test_conditions_apply_to_the_default_measure_selection() -> None:
    compiled = _plan(having=({"measure": "orders", "operator": "gt", "value": 1},))
    assert "HAVING count(`customer_id`) > " in compiled.sql


@pytest.mark.parametrize(
    ("condition", "message"),
    [
        (
            {"measure": "orders", "operator": "gt", "value": 1},
            'Having measure "orders" must be one of the selected measures: revenue',
        ),
        ({"measure": "revenue", "operator": "gt", "value": True}, "expects a finite number"),
        ({"measure": "revenue", "operator": "gt", "value": "1"}, "expects a finite number"),
        ({"measure": "revenue", "operator": "gt", "value": 10**400}, "expects a finite number"),
        ({"measure": "revenue", "operator": "in", "value": [1, 10**400]}, "non-empty array"),
        ({"measure": "revenue", "operator": "gt", "value": [1]}, "expects a finite number"),
        ({"measure": "revenue", "operator": "between", "value": [1]}, "two-item array"),
        ({"measure": "revenue", "operator": "between", "value": [1, "2"]}, "two-item array"),
        ({"measure": "revenue", "operator": "in", "value": []}, "non-empty array"),
        ({"measure": "revenue", "operator": "notIn", "value": 1}, "non-empty array"),
    ],
)
def test_invalid_conditions_are_rejected(condition: dict[str, object], message: str) -> None:
    assert message in _error(measures=("revenue",), having=(condition,))


def test_like_and_unknown_fields_are_not_conditions() -> None:
    with pytest.raises(ValueError, match="operator"):
        DatasetQuery.model_validate(
            {"having": [{"measure": "revenue", "operator": "like", "value": 1}]}
        )
    with pytest.raises(ValueError, match="sql"):
        DatasetQuery.model_validate(
            {"having": [{"measure": "revenue", "operator": "gt", "value": 1, "sql": "1"}]}
        )


def test_conditions_count_against_the_filter_limit() -> None:
    condition = {"measure": "revenue", "operator": "gt", "value": 1}
    assert "Too many filters and having conditions: 3 (max 2)" in _error(
        measures=("revenue",), having=(condition, condition, condition)
    )
    paid = {"field": "status", "operator": "eq", "value": "paid"}
    assert "Too many filters and having conditions: 3 (max 2)" in _error(
        measures=("revenue",), filters=(paid, paid), having=(condition,)
    )
    assert _plan(measures=("revenue",), filters=(paid,), having=(condition,))


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


@dataclass
class Executor:
    seen: list[CompiledQuery] = field(default_factory=list)

    def execute(self, compiled: CompiledQuery) -> Rows:
        self.seen.append(compiled)
        return Rows(("revenue",), ((12,),))


def test_queries_with_conditions_bypass_the_result_cache() -> None:
    executor = Executor()
    cache = ResultCache(store=MemoryCacheStore(), project="p", environment="e", ttl_seconds=60)
    client = create_dataset_client(executor=executor, cache=cache)
    plain = DatasetQuery(measures=("revenue",))
    filtered = DatasetQuery.model_validate(
        {"measures": ["revenue"], "having": [{"measure": "revenue", "operator": "gt", "value": 1}]}
    )
    assert client.execute(Orders, plain).meta.cache == "miss"
    assert client.execute(Orders, filtered).meta.cache == "bypass"
    assert client.execute(Orders, filtered).meta.cache == "bypass"
    assert client.execute(Orders, plain).meta.cache == "hit"
    assert sum("HAVING" in compiled.sql for compiled in executor.seen) == 2


def _app(executor: Executor) -> TestClient:
    def authenticate(credential: Credential) -> Principal | None:
        return Principal(subject="reader") if credential.value == "token" else None

    client = create_dataset_client(executor=executor)
    router = create_router(authenticate=authenticate)
    add_dataset_endpoint(router, "/orders", dataset=Orders, client=client)
    add_metric_endpoint(router, "/revenue", dataset=Orders, measure="revenue", client=client)
    app = create_app(router, security=HttpSecurity(allowed_hosts=("testserver",)))
    return TestClient(app, headers={"Authorization": "Bearer token"})


def test_dataset_endpoints_forward_conditions_and_metric_endpoints_refuse_them() -> None:
    executor = Executor()
    http = _app(executor)
    body = {
        "measures": ["revenue"],
        "having": [{"measure": "revenue", "operator": "gte", "value": 10}],
    }
    response = http.post("/orders", json=body)
    assert response.status_code == 200, response.text
    assert "HAVING sum(`amount`) >= {p0:Float64}" in executor.seen[-1].sql

    invalid = http.post(
        "/orders",
        json={
            "measures": ["revenue"],
            "having": [{"measure": "orders", "operator": "gt", "value": 1}],
        },
    )
    assert invalid.status_code == 400
    malformed = http.post("/orders", json={"having": [{"measure": "revenue"}]})
    assert malformed.status_code == 400

    metric = http.post("/revenue", json={"having": body["having"]})
    assert metric.status_code == 400
    assert len(executor.seen) == 1


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
def test_live_having_filters_grouped_and_ungrouped_results() -> None:
    import clickhouse_connect

    from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

    host = os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"]
    port = int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123"))
    password = os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"]
    admin = clickhouse_connect.get_client(
        host=host, port=port, username="default", password=password
    )
    # A fresh name, created without IF NOT EXISTS: the test only ever drops the
    # database it created itself.
    database = f"hq_having_orders_{secrets.token_hex(6)}"
    admin.command(f"CREATE DATABASE {database}")
    executor = create_clickhouse_executor(
        ClickHouseConnection(
            host=host, port=port, database=database, username="default", password=password
        )
    )
    orders = Dataset(
        name="havingOrders",
        source="orders",
        dimensions={
            "customerId": dimension("string", column="customer_id"),
            "amount": dimension("number"),
            "status": dimension("string"),
        },
        measures={
            "revenue": measure(sum_("amount")),
            "paidRevenue": measure(sum_("amount"), filters=(eq("status", "paid"),)),
        },
    )
    try:
        admin.command(
            f"CREATE TABLE {database}.orders "
            "(customer_id String, amount Float64, status String) ENGINE = Memory"
        )
        admin.command(
            f"INSERT INTO {database}.orders VALUES "  # noqa: S608 - generated name
            "('a', 6000, 'paid'), ('a', 5000, 'open'), ('b', 9000, 'paid'), ('c', 20000, 'paid')"
        )
        client = create_dataset_client(executor=executor)
        grouped = client.execute(
            orders,
            DatasetQuery.model_validate(
                {
                    "dimensions": ["customerId"],
                    "measures": ["revenue", "paidRevenue"],
                    "having": [{"measure": "revenue", "operator": "gt", "value": 10_000}],
                    "order_by": [{"field": "customerId", "direction": "asc"}],
                }
            ),
        ).data
        assert grouped == (
            {"customerId": "a", "revenue": 11000.0, "paidRevenue": 6000.0},
            {"customerId": "c", "revenue": 20000.0, "paidRevenue": 20000.0},
        )
        paid_between = client.execute(
            orders,
            DatasetQuery.model_validate(
                {
                    "dimensions": ["customerId"],
                    "measures": ["paidRevenue"],
                    "having": [
                        {"measure": "paidRevenue", "operator": "between", "value": [5000, 10000]}
                    ],
                    "order_by": [{"field": "customerId", "direction": "asc"}],
                }
            ),
        ).data
        assert paid_between == (
            {"customerId": "a", "paidRevenue": 6000.0},
            {"customerId": "b", "paidRevenue": 9000.0},
        )
        ungrouped = client.execute(
            orders,
            DatasetQuery.model_validate(
                {
                    "measures": ["revenue"],
                    "having": [{"measure": "revenue", "operator": "in", "value": [40000]}],
                }
            ),
        ).data
        assert ungrouped == ({"revenue": 40000.0},)
        empty = client.execute(
            orders,
            DatasetQuery.model_validate(
                {
                    "measures": ["revenue"],
                    "having": [{"measure": "revenue", "operator": "lt", "value": 0}],
                }
            ),
        ).data
        assert empty == ()
    finally:
        executor.close()
        admin.command(f"DROP DATABASE IF EXISTS {database}")
        admin.close()


@pytest.mark.skipif(
    "HYPEQUERY_TEST_CLICKHOUSE_HOST" not in os.environ,
    reason="live ClickHouse service is not configured",
)
def test_live_having_on_relationship_measures_skips_unmatched_rows() -> None:
    import clickhouse_connect

    from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

    host = os.environ["HYPEQUERY_TEST_CLICKHOUSE_HOST"]
    port = int(os.environ.get("HYPEQUERY_TEST_CLICKHOUSE_PORT", "8123"))
    password = os.environ["HYPEQUERY_TEST_CLICKHOUSE_PASSWORD"]
    admin = clickhouse_connect.get_client(
        host=host, port=port, username="default", password=password
    )
    # A fresh name, created without IF NOT EXISTS: the test only ever drops the
    # database it created itself.
    database = f"hq_having_relationships_{secrets.token_hex(6)}"
    admin.command(f"CREATE DATABASE {database}")
    executor = create_clickhouse_executor(
        ClickHouseConnection(
            host=host, port=port, database=database, username="default", password=password
        )
    )
    try:
        admin.command(f"CREATE TABLE {database}.targets (id UInt32, score Float64) ENGINE = Memory")
        admin.command(
            f"CREATE TABLE {database}.sources "
            "(id UInt32, target_id UInt32, status String, amount Float64) ENGINE = Memory"
        )
        admin.command(f"INSERT INTO {database}.targets VALUES (1, 10), (2, 20), (3, 30)")  # noqa: S608
        # Source 4 matches no target: its group's target aggregate is NULL, and
        # must not pass a condition as a default 0 would.
        admin.command(
            f"INSERT INTO {database}.sources VALUES "  # noqa: S608 - generated name
            "(1, 1, 'paid', 5), (2, 2, 'paid', 7), (3, 3, 'open', 1), (4, 9, 'refund', 2)"
        )
        targets = Dataset(
            name="havingTargets",
            source="targets",
            dimensions={"id": dimension("number"), "score": dimension("number")},
            measures={"highest": measure(max("score"))},
        )
        sources = Dataset(
            name="havingSources",
            source="sources",
            dimensions={"status": dimension("string"), "amount": dimension("number")},
            measures={"total": measure(sum_("amount"))},
            relationships={
                "target": belongs_to(lambda: targets, from_field="target_id", to_field="id")
            },
        )
        client = create_dataset_client(
            executor=executor, registry=create_dataset_registry(sources, targets)
        )

        def having(operator: str, value: float) -> tuple[dict[str, ResultScalar], ...]:
            return client.execute(
                "havingSources",
                DatasetQuery.model_validate(
                    {
                        "dimensions": ["status"],
                        "measures": ["total", "target.highest"],
                        "having": [
                            {"measure": "target.highest", "operator": operator, "value": value}
                        ],
                        "order_by": [{"field": "status", "direction": "asc"}],
                    }
                ),
            ).data

        assert having("gt", 15) == (
            {"status": "open", "total": 1.0, "target.highest": 30.0},
            {"status": "paid", "total": 12.0, "target.highest": 20.0},
        )
        assert having("lt", 25) == ({"status": "paid", "total": 12.0, "target.highest": 20.0},)
    finally:
        executor.close()
        admin.command(f"DROP DATABASE IF EXISTS {database}")
        admin.close()

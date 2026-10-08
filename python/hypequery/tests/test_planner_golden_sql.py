"""Golden SQL: every compiler path, pinned byte for byte.

Structural refactors of the planner (and of anything that renders SQL) must
leave this snapshot unchanged. An intentional SQL change regenerates it in its
own PR with ``HYPEQUERY_UPDATE_SNAPSHOTS=1 uv run pytest tests/test_planner_golden_sql.py``
and explains every changed statement in review.

Each case records the statement, the typed parameters in allocation order, and
the redacted debug form, so a change in parameter order or type is caught as
surely as a change in text.
"""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Mapping
from pathlib import Path

import pytest

from golden_model import ACME, ALL, REGISTRY, SEVERAL, Events, Orders
from hypequery.datasets import Dataset, DatasetQuery, ExecutionContext, plan_dataset_query
from hypequery.datasets import filter as f
from hypequery.datasets import order as o
from hypequery.datasets.planner import CompiledQuery
from hypequery.datasets.query_helpers import HavingCondition
from hypequery.datasets.relationship_check_plan import plan_relationship_checks

SNAPSHOT = Path(__file__).parent / "snapshots" / "planner_golden_sql.json"
UPDATE = os.environ.get("HYPEQUERY_UPDATE_SNAPSHOTS") == "1"


def _plan(
    dataset: Dataset,
    context: ExecutionContext | None = None,
    *,
    overfetch: bool = False,
    **query: object,
) -> Callable[[], CompiledQuery]:
    def plan() -> CompiledQuery:
        return plan_dataset_query(
            dataset,
            DatasetQuery.model_validate(query),
            registry=REGISTRY,
            context=context,
            overfetch=overfetch,
        )

    return plan


def _having(measure_name: str, operator: str, value: object) -> HavingCondition:
    return HavingCondition.model_validate(
        {"measure": measure_name, "operator": operator, "value": value}
    )


CASES: Mapping[str, Callable[[], CompiledQuery]] = {
    # Selection and aggregation
    "default-measures": _plan(Orders, ACME),
    "every-aggregation": _plan(
        Orders,
        ACME,
        dimensions=("status",),
        measures=(
            "revenue",
            "orders",
            "uniqueCustomers",
            "avgAmount",
            "minAmount",
            "maxAmount",
            "medianAmount",
            "p95Amount",
            "spread",
            "variance",
            "lastStatus",
            "firstStatus",
        ),
    ),
    "measure-filters": _plan(Orders, ACME, measures=("paidRevenue", "revenue")),
    "measure-filters-on-parametric-and-distinct": _plan(
        Orders, ACME, measures=("paidP90", "paidCustomers")
    ),
    "measure-filter-through-join": _plan(Orders, ACME, measures=("goldRevenue",)),
    "sql-backed-fields": _plan(Events, dimensions=("doubled",), measures=("rawTotal", "events")),
    # Derived formulas
    "derived-chain": _plan(Orders, ACME, measures=("rounded", "average", "paidShare")),
    "derived-arithmetic": _plan(Orders, ACME, measures=("net", "bounds", "big", "nothing")),
    # Relationships
    "relationship-dimension-filter-order": _plan(
        Orders,
        ACME,
        dimensions=("customer.country",),
        measures=("revenue",),
        filters=(f.eq("customer.tier", "gold"),),
        order_by=(o.desc("revenue"), o.asc("customer.country")),
    ),
    "relationship-measures": _plan(
        Orders,
        ACME,
        dimensions=("status",),
        measures=(
            "revenue",
            "customer.customerCount",
            "customer.bestScore",
            "customer.latestTier",
            "customer.goldCustomers",
        ),
    ),
    "has-one-measures": _plan(
        Orders, ACME, measures=("profile.profileAge", "profile.profileCount")
    ),
    "composite-key-and-marker-collision": _plan(
        Orders, ACME, dimensions=("account.name",), measures=("account.accountCount",)
    ),
    "relationship-with-several-tenants": _plan(
        Orders, SEVERAL, dimensions=("customer.country",), measures=("orders",)
    ),
    "relationship-all-tenants": _plan(
        Orders, ALL, dimensions=("customer.country",), measures=("orders",)
    ),
    "related-measure-beside-derived": _plan(
        Orders, ACME, measures=("average", "customer.customerCount")
    ),
    # Filters
    "filter-operators": _plan(
        Orders,
        ACME,
        measures=("orders",),
        filters=(
            f.eq("status", "paid"),
            f.neq("status", "void"),
            f.gt("amount", 1),
            f.gte("amount", 2.5),
            f.lt("amount", 100),
            f.lte("amount", 99),
            f.in_list("status", ["a", "b"]),
            f.not_in_list("status", ["c"]),
            f.between("amount", 1, 10),
            f.like("status", "pa%"),
            f.eq("paid", True),
            f.in_list("statusOnly", ["x"]),
        ),
    ),
    "time-filters-in-zone": _plan(
        Orders,
        ACME,
        measures=("orders",),
        timezone="America/New_York",
        filters=(
            f.gte("created_at", "2026-03-08T00:00:00"),
            f.lt("created_at", "2026-03-09T00:00:00Z"),
            f.between("created", "2026-01-01T00:00:00", "2026-02-01T00:00:00"),
            f.in_list("created_at", ["2026-01-01T00:00:00+02:00"]),
        ),
    ),
    # Time
    **{
        f"grain-{grain}": _plan(Events, measures=("events",), by=grain)
        for grain in ("minute", "hour", "day", "week", "month", "quarter", "year")
    },
    "grain-with-zone-dimensions-and-order": _plan(
        Events,
        dimensions=("kind",),
        measures=("total",),
        by="day",
        timezone="Asia/Kolkata",
        order_by=(o.desc("total"),),
    ),
    "grain-on-tenant-dataset": _plan(Orders, ACME, measures=("revenue",), by="month"),
    # Having
    "having-every-operator": _plan(
        Orders,
        ACME,
        dimensions=("status",),
        measures=("revenue", "orders", "customer.customerCount"),
        having=(
            _having("revenue", "gt", 10),
            _having("revenue", "gte", 10.5),
            _having("orders", "lt", 100),
            _having("orders", "lte", 99),
            _having("orders", "eq", 3),
            _having("orders", "neq", 4),
            _having("revenue", "between", [1, 2]),
            _having("orders", "in", [1, 2, 3]),
            _having("orders", "notIn", [5]),
            _having("customer.customerCount", "gte", 1),
        ),
    ),
    "having-on-default-selection": _plan(
        Events, measures=None, having=(_having("events", "gt", 0),)
    ),
    "having-on-derived": _plan(
        Orders, ACME, measures=("average",), having=(_having("average", "gt", 2),)
    ),
    # Pagination and limits
    "limit-offset": _plan(Orders, ACME, measures=("orders",), limit=10, offset=20),
    "overfetch": _plan(Orders, ACME, overfetch=True, measures=("orders",), limit=10),
    "dataset-result-cap": _plan(Events, measures=("events",)),
    "dataset-result-cap-overfetch": _plan(Events, overfetch=True, measures=("events",)),
}


def _record(compiled: CompiledQuery) -> dict[str, object]:
    return {
        "sql": compiled.sql,
        "parameters": [
            [name, parameter.clickhouse_type, parameter.value]
            for name, parameter in compiled.parameters.items()
        ],
        "debug": compiled.to_sql(),
    }


def _relationship_checks() -> dict[str, object]:
    checks: dict[str, object] = {}
    for context_name, context in (("acme", ACME), ("several", SEVERAL)):
        for check in plan_relationship_checks(Orders, REGISTRY, context, None):
            checks[f"{context_name}:{check.name}"] = _record(check.compiled)
    return checks


def _current() -> dict[str, object]:
    return {
        "queries": {name: _record(plan()) for name, plan in CASES.items()},
        "relationshipChecks": _relationship_checks(),
    }


def _encode(snapshot: Mapping[str, object]) -> str:
    return json.dumps(snapshot, indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def test_golden_sql_snapshot() -> None:
    current = _encode(_current())
    if UPDATE:
        SNAPSHOT.parent.mkdir(exist_ok=True)
        SNAPSHOT.write_text(current, encoding="utf-8")
    assert SNAPSHOT.exists(), "run with HYPEQUERY_UPDATE_SNAPSHOTS=1 to create the snapshot"
    expected = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    actual = json.loads(current)
    for section in ("queries", "relationshipChecks"):
        assert sorted(actual[section]) == sorted(expected[section]), section
        for name, record in expected[section].items():
            assert actual[section][name] == record, f"{section}:{name}"


@pytest.mark.parametrize("name", sorted(CASES))
def test_each_case_plans(name: str) -> None:
    # A case that stops planning would otherwise surface only as a snapshot diff.
    assert CASES[name]().sql.startswith("SELECT ")

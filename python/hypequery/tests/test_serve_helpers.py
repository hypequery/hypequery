"""ScopeSlot and MetricAlias: the small helpers serve's request path relies on."""

from __future__ import annotations

from hypequery.datasets.planner import DatasetQuery
from hypequery.datasets.query_helpers import asc, desc
from hypequery.serve.utils.metric_alias import MetricAlias
from hypequery.serve.utils.scope_slot import ScopeSlot


def test_a_slot_reads_only_its_own_exact_type() -> None:
    slot: ScopeSlot[str] = ScopeSlot(str)
    other: ScopeSlot[str] = ScopeSlot(str)
    scope: dict[str, object] = {"type": "http"}

    assert slot.get(scope) is None
    slot.set(scope, "abc")
    assert slot.get(scope) == "abc"
    # Another slot of the same type has its own key.
    assert other.get(scope) is None


class _LookAlike(str):
    pass


def test_a_subclass_look_alike_is_treated_as_absent() -> None:
    slot: ScopeSlot[str] = ScopeSlot(str)
    scope: dict[str, object] = {}
    slot.set(scope, _LookAlike("forged"))
    assert slot.get(scope) is None


def test_setdefault_creates_once_and_keeps_empty_containers() -> None:
    slot: ScopeSlot[set[str]] = ScopeSlot(set)
    scope: dict[str, object] = {}
    first = slot.setdefault(scope, set)
    second = slot.setdefault(scope, set)
    assert first is second
    first.add("x")
    assert slot.get(scope) == {"x"}


def test_a_metric_alias_maps_orderings_in_and_columns_out() -> None:
    alias = MetricAlias(measure="revenue", name="sales")
    query = DatasetQuery(order_by=(desc("sales"), asc("country")))

    assert [order.field for order in alias.query(query).order_by] == ["revenue", "country"]
    assert alias.rows([{"country": "NZ", "revenue": 3}]) == [{"country": "NZ", "sales": 3}]


def test_an_alias_equal_to_its_measure_changes_nothing() -> None:
    alias = MetricAlias(measure="revenue", name="revenue")
    rows: list[dict[str, str | int | float | bool | None]] = [{"revenue": 1}]
    assert alias.rows(rows) is rows

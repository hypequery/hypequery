"""MetricAlias: the metric endpoint's renaming of its measure."""

from __future__ import annotations

from hypequery.datasets.planner import DatasetQuery
from hypequery.datasets.query_helpers import asc, desc
from hypequery.serve.utils.metric_alias import MetricAlias


def test_a_metric_alias_maps_orderings_in_and_columns_out() -> None:
    alias = MetricAlias(measure="revenue", name="sales")
    query = DatasetQuery(order_by=(desc("sales"), asc("country")))

    assert [order.field for order in alias.query(query).order_by] == ["revenue", "country"]
    assert alias.rows([{"country": "NZ", "revenue": 3}]) == [{"country": "NZ", "sales": 3}]


def test_an_alias_equal_to_its_measure_changes_nothing() -> None:
    alias = MetricAlias(measure="revenue", name="revenue")
    rows: list[dict[str, str | int | float | bool | None]] = [{"revenue": 1}]
    assert alias.rows(rows) is rows

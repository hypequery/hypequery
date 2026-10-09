"""The dialect seam: compilation spells every ClickHouse construct through it."""

from __future__ import annotations

from golden_model import ACME, REGISTRY, Orders
from hypequery.datasets import DatasetQuery
from hypequery.datasets.planner.compiler import DatasetQueryCompiler
from hypequery.datasets.planner.dialects import CLICKHOUSE, ClickHouseDialect, SqlDialect
from hypequery.datasets.planner.query_node import DatasetSelectNode
from hypequery.datasets.relationship_check_plan import plan_relationship_checks


class _MarkedDialect(ClickHouseDialect):
    """ClickHouse, but with its dialect-owned spellings visibly marked."""

    __slots__ = ()

    def in_time_zone(self, column: str, zone_placeholder: str) -> str:
        return f"ZONED({column}, {zone_placeholder})"

    def row_count(self) -> str:
        return "ROWS()"

    def render_select(self, node: DatasetSelectNode) -> str:
        return super().render_select(node).replace("LEFT ANY JOIN", "LEFT SINGLE JOIN")


def _compile(dialect: SqlDialect, query: DatasetQuery) -> str:
    return DatasetQueryCompiler(Orders, query, REGISTRY, ACME, dialect=dialect).compile().sql


def test_clickhouse_is_the_default_dialect() -> None:
    query = DatasetQuery(dimensions=("customer.country",), measures=("revenue",), by="month")
    default = DatasetQueryCompiler(Orders, query, REGISTRY, ACME).compile().sql
    assert default == _compile(CLICKHOUSE, query)


def test_a_dialect_owns_join_zone_and_count_spellings() -> None:
    query = DatasetQuery(dimensions=("customer.country",), measures=("revenue",), by="month")
    sql = _compile(_MarkedDialect(), query)

    assert "LEFT SINGLE JOIN" in sql
    assert "ZONED(`__hq_base`.`created_at`, {p0:String})" in sql
    assert "toDateTime64" not in sql

    checks = plan_relationship_checks(
        Orders, REGISTRY, ACME, ("customer",), dialect=_MarkedDialect()
    )
    assert checks[0].compiled.sql.startswith("SELECT ROWS() AS `__hq_rows`")

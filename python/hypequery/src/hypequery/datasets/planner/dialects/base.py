"""What compilation needs from a SQL dialect.

Features resolve names, allocate parameters and decide structure; a dialect
decides only spelling. Every operand a dialect receives is already safe SQL —
a quoted identifier, an allocated placeholder, or a trusted expression — so a
dialect never sees, and never has to escape, a caller's value.

Mirrors `SqlDialect` in `@hypequery/clickhouse`. ClickHouse is the only
implementation today; a second dialect must reproduce the semantics the
ClickHouse one documents, not merely its syntax.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from ...dimensions import DimensionType
    from ...measures import Measure
    from ..aggregates import AggregateCall
    from ..query_node import DatasetSelectNode


class SqlDialect(Protocol):
    @property
    def name(self) -> str: ...

    def parameter_type(self, field_type: DimensionType) -> str:
        """The parameter type a filter value on a dimension of *field_type* binds as."""
        ...

    def aggregate(self, name: str, measure: Measure, target: str, arg: str | None) -> AggregateCall:
        """The aggregate call for *measure* over already-resolved input SQL."""
        ...

    def conditional(self, aggregate: AggregateCall, condition: str) -> AggregateCall:
        """*aggregate* restricted to the rows where *condition* holds."""
        ...

    def truncate_to_grain(self, grain: str, column: str) -> str:
        """*column* truncated to the start of its *grain* bucket."""
        ...

    def period_text(self, bucket: str) -> str:
        """A grain bucket rendered as RFC 0015's period text."""
        ...

    def in_time_zone(self, column: str, zone_placeholder: str) -> str:
        """*column* read as an instant in the bound zone."""
        ...

    def not_null(self, expression: str) -> str: ...

    def match_marker(self, alias: str) -> str:
        """A projected column that is non-null exactly when a join matched."""
        ...

    def when(self, condition: str, expression: str) -> str:
        """*expression* where *condition* holds, else NULL."""
        ...

    def row_count(self) -> str: ...

    def distinct_count(self, columns: list[str]) -> str:
        """The exact number of distinct (possibly composite) keys over *columns*."""
        ...

    def render_select(self, node: DatasetSelectNode) -> str: ...

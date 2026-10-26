"""What compilation needs from a SQL dialect.

Features resolve names, allocate parameters and decide structure; a dialect
decides only spelling. Every operand a dialect receives is already safe SQL —
a quoted identifier, an allocated placeholder, or a trusted expression — so a
dialect never sees, and never has to escape, a caller's value.

A dialect must reproduce the semantics the ClickHouse one documents, not
merely its syntax: the same rows, buckets and values for the same query.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from ...dimensions import DimensionType
    from ...measures import Measure
    from ..query_node import DatasetSelectNode


class Aggregate(Protocol):
    """An aggregate call a dialect built; features only render it."""

    @property
    def sql(self) -> str: ...


class SqlDialect(Protocol):
    @property
    def name(self) -> str: ...

    # Identifiers and parameters

    def quote(self, name: str) -> str:
        """One validated identifier in the dialect's quoted form."""
        ...

    def placeholder(self, name: str, index: int, sql_type: str) -> str:
        """The placeholder for the parameter allocated *index*-th (from 0)."""
        ...

    def parameter_type(self, field_type: DimensionType) -> str:
        """The parameter type a filter value on a dimension of *field_type* binds as."""
        ...

    def scalar_type(self, name: str) -> str:
        """A scalar parameter type, given by its ClickHouse name (`String`, `Float64`, `UInt8`…)."""
        ...

    def array_type(self, element_type: str) -> str:
        """The type of an array of *element_type* values, bound as one parameter."""
        ...

    # Predicates

    def membership(self, column: str, array_placeholder: str, *, negated: bool) -> str:
        """Whether *column* is (or, *negated*, is not) one of a bound array's values."""
        ...

    def time_comparison(
        self, column: str, zone_placeholder: str, probe: str
    ) -> tuple[str, Callable[[str], str] | None]:
        """The operands for comparing a time-key *column* with bound instants.

        Returns the column side and, when the dialect converts values rather
        than the column, a function spelling each bound value's placeholder.
        *probe* is a zero-row scalar with the column's type, for dialects that
        compare the bare column so its index applies.
        """
        ...

    # Aggregates and formulas

    def aggregate(self, name: str, measure: Measure, target: str, arg: str | None) -> Aggregate:
        """The aggregate call for *measure* over already-resolved input SQL."""
        ...

    def conditional(self, aggregate: Aggregate, condition: str) -> Aggregate:
        """*aggregate* restricted to the rows where *condition* holds."""
        ...

    def divide(self, left: str, right: str) -> str:
        """Floating-point division of two formula operands."""
        ...

    def round(self, expression: str, decimals_placeholder: str) -> str:
        """*expression* rounded to a bound number of decimal places."""
        ...

    # Time

    def truncate_to_grain(self, grain: str, column: str, zone_placeholder: str) -> str:
        """*column* (an instant from `in_time_zone`) truncated to its *grain* bucket."""
        ...

    def period_text(self, bucket: str, grain: str, zone_placeholder: str) -> str:
        """A grain bucket rendered as RFC 0015's period text."""
        ...

    def in_time_zone(self, column: str, zone_placeholder: str) -> str:
        """*column* read as an instant in the bound zone."""
        ...

    # Joins and structure

    def not_null(self, expression: str) -> str: ...

    def match_marker(self, alias: str) -> str:
        """A projected column that is non-null exactly when a join matched."""
        ...

    def when(self, condition: str, expression: str) -> str:
        """*expression* where *condition* holds, else NULL."""
        ...

    def group_key(self, expression: str, alias: str) -> str:
        """The GROUP BY item for a dimension selected as `expression AS alias`."""
        ...

    def order_term(self, expression: str, descending: bool) -> str:
        """One ORDER BY item; NULLs sort last in both directions."""
        ...

    def row_count(self) -> str: ...

    def distinct_count(self, columns: list[str]) -> str:
        """The exact number of distinct (possibly composite) keys over *columns*."""
        ...

    def render_select(self, node: DatasetSelectNode) -> str: ...

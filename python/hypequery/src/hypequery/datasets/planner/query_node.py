"""The clauses of one compiled statement, before they are rendered as text.

Features fill a `DatasetSelectNode` with already-safe fragments — quoted
identifiers, allocated placeholders, trusted expressions — and `render_select`
joins them. Keeping the clauses as structure until the end is what lets a
dialect decide the syntax around them, such as the single-match join keyword.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .identifiers import SafeIdentifier
from .sql_fragments import (
    group_by_clause,
    having_clause,
    order_by_clause,
    pagination_clause,
    select_clause,
    where_clause,
)


@dataclass(frozen=True, slots=True)
class JoinNode:
    """A single-match left join: each base row meets at most one target row."""

    source: str
    alias: SafeIdentifier
    condition: str


@dataclass(slots=True)
class DatasetSelectNode:
    """One grouped SELECT over a dataset source, accumulated clause by clause."""

    source: str = ""
    #: Set when a relationship join makes base columns ambiguous.
    base_alias: SafeIdentifier | None = None
    selections: list[str] = field(default_factory=list)
    joins: list[JoinNode] = field(default_factory=list)
    where: list[str] = field(default_factory=list)
    group_by: list[str] = field(default_factory=list)
    having: list[str] = field(default_factory=list)
    order_by: list[str] = field(default_factory=list)
    limit: int | None = None
    offset: int | None = None


def render_select(node: DatasetSelectNode) -> str:
    """The ClickHouse statement for *node*."""

    from_clause = f" FROM {node.source}"
    if node.base_alias is not None:
        from_clause += f" AS {node.base_alias.sql}"
    joins = "".join(
        f" LEFT ANY JOIN {join.source} AS {join.alias.sql} ON {join.condition}"
        for join in node.joins
    )
    return (
        select_clause(node.selections)
        + from_clause
        + joins
        + where_clause(node.where)
        + group_by_clause(node.group_by)
        + having_clause(node.having)
        + order_by_clause(node.order_by)
        + pagination_clause(node.limit, node.offset)
    )

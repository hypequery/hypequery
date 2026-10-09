"""The clauses of one compiled statement, before they are rendered as text.

Features fill a `DatasetSelectNode` with already-safe fragments — quoted
identifiers, allocated placeholders, trusted expressions — and the dialect's
`render_select` joins them. Keeping the clauses as structure until the end is
what lets a dialect decide the syntax around them, such as the join keyword.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .identifiers import SafeIdentifier


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

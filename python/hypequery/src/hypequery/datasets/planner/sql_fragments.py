"""Pure SQL fragment builders.

These take already-safe pieces — quoted identifiers, allocated placeholders —
and join them. They hold no planner state and know nothing about datasets,
which keeps the planner itself about resolution and this about syntax.
"""

from __future__ import annotations

from collections.abc import Sequence

from ..constants import GRAIN_FUNCTIONS
from .errors import CompiledQueryError
from .identifiers import SafeIdentifier


def grain_expression(grain: str, column_sql: str) -> str:
    """Wrap a time column in the truncation function for *grain*."""

    function = GRAIN_FUNCTIONS.get(grain)
    if function is None:
        supported = ", ".join(GRAIN_FUNCTIONS)
        raise CompiledQueryError(
            "input-invalid", f'Unsupported time grain "{grain}". Supported: {supported}'
        )
    return f"{function}({column_sql})"


def aliased(expression: str, alias: SafeIdentifier) -> str:
    """`<expression> AS <alias>`, with the alias quoted."""

    return f"{expression} AS {alias.sql}"


def select_clause(parts: Sequence[str]) -> str:
    return "SELECT " + ", ".join(parts)


def where_clause(predicates: Sequence[str]) -> str:
    return "" if not predicates else " WHERE " + " AND ".join(predicates)


def group_by_clause(parts: Sequence[str]) -> str:
    return "" if not parts else " GROUP BY " + ", ".join(parts)


def order_by_clause(parts: Sequence[str]) -> str:
    return "" if not parts else " ORDER BY " + ", ".join(parts)


def pagination_clause(limit: int | None, offset: int | None) -> str:
    """`LIMIT`/`OFFSET`, rendered from integers rather than bound.

    These are the one pair of caller-supplied numbers written into the text.
    They are formatted with `:d`, so the only thing that can reach the SQL is
    the decimal form of an `int` the query model already bounded to a
    non-negative value — no string a caller sends has a path here. ClickHouse
    does not accept a server parameter in either position.
    """

    clause = ""
    if limit is not None:
        clause += f" LIMIT {limit:d}"
    if offset is not None:
        clause += f" OFFSET {offset:d}"
    return clause

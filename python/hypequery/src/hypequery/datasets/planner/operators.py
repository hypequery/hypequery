"""SQL spellings of the semantic comparison operators."""

from __future__ import annotations

from typing import Final

#: Operators whose value is a list, bound as one array parameter.
ARRAY_OPERATORS: Final = frozenset(("in", "notIn"))

#: Scalar comparisons and the SQL operator each renders as.
COMPARISON_SQL: Final = {"eq": "=", "neq": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}


def membership_keyword(operator: str) -> str:
    """`IN` or `NOT IN` for an array operator."""

    return "IN" if operator == "in" else "NOT IN"

"""Shared semantic-layer constants.

These mirror `packages/datasets/src/constants.ts`. They are the sets a
catalog advertises, so they are kept here rather than inlined at each use.
"""

from __future__ import annotations

from typing import Final

from .query_helpers import FilterOperator, OrderDirection
from .relationships import RelationshipKind

#: ClickHouse date-truncation function per supported grain.
GRAIN_FUNCTIONS: Final[dict[str, str]] = {
    "minute": "toStartOfMinute",
    "hour": "toStartOfHour",
    "day": "toStartOfDay",
    "week": "toStartOfWeek",
    "month": "toStartOfMonth",
    "quarter": "toStartOfQuarter",
    "year": "toStartOfYear",
}

#: The time grains the planner supports, derived from GRAIN_FUNCTIONS so the
#: two never drift apart.
SUPPORTED_TIME_GRAINS: Final[tuple[str, ...]] = tuple(GRAIN_FUNCTIONS)

#: The filter operators accepted by semantic dataset and metric inputs.
SEMANTIC_FILTER_OPERATORS: Final[tuple[FilterOperator, ...]] = (
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "in",
    "notIn",
    "between",
    "like",
)

#: Relationships that may be joined. `hasMany` stays metadata-only because
#: joining it would fan out and corrupt aggregates.
QUERYABLE_RELATIONSHIP_KINDS: Final[tuple[RelationshipKind, ...]] = ("belongsTo", "hasOne")

ORDER_DIRECTIONS: Final[tuple[OrderDirection, ...]] = ("asc", "desc")


def is_supported_time_grain(grain: object) -> bool:
    """Return whether *grain* is one of the supported time grains."""

    return type(grain) is str and grain in GRAIN_FUNCTIONS

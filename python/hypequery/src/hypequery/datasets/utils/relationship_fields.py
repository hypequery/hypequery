"""Resolution helpers for relationship-qualified field names.

v1 supports one hop over to-one relationships (`belongsTo`, `hasOne`) only,
addressing dimensions declared on the target dataset. `hasMany` stays
metadata-only to avoid fan-out corruption of aggregates.

Unlike the TypeScript helpers, these take the resolved target dataset rather
than calling a stored callback: a Python relationship keeps only its target's
name, so nothing executable is ever held in a definition. Callers resolve the
name through a registry first.
"""

from __future__ import annotations

from ..constants import QUERYABLE_RELATIONSHIP_KINDS
from ..dataset import Dataset
from ..relationships import Relationship


def _relationship_fields(
    name: str, relationship: Relationship, target: Dataset, *, groupable_only: bool
) -> tuple[str, ...]:
    if relationship.kind not in QUERYABLE_RELATIONSHIP_KINDS:
        return ()
    return tuple(
        f"{name}.{field}"
        for field, dimension in target.dimensions.items()
        # SQL-backed target dimensions are not yet queryable through a join.
        if dimension.sql is None and not (groupable_only and dimension.groupable is False)
    )


def list_queryable_relationship_fields(
    name: str, relationship: Relationship, target: Dataset
) -> tuple[str, ...]:
    """The qualified field names (`<name>.<dimension>`) a relationship contributes.

    This applies the same rules query-time resolution enforces, so the catalog
    and the planner advertise exactly the same list.
    """

    return _relationship_fields(name, relationship, target, groupable_only=False)


def list_groupable_relationship_fields(
    name: str, relationship: Relationship, target: Dataset
) -> tuple[str, ...]:
    """The subset of the queryable fields usable as a grouping key.

    A `groupable: False` target dimension stays queryable as a filter, which is
    why this is a separate list rather than a narrowing of the one above.
    """

    return _relationship_fields(name, relationship, target, groupable_only=True)

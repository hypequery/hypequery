"""Which target measures a relationship may aggregate through.

A query may select `<relationship>.<measure>`: one hop over a to-one
relationship, to a base aggregate on the target. A `belongsTo` repeats each
target row once per matching base row, so only aggregates that ignore
duplicates are safe through it. A declared `hasOne` matches at most one target
row per base row, so every aggregate is. Mirrors
`packages/datasets/src/utils/relationship-measures.ts`.

Like the field helpers beside it, these take the resolved target dataset, so
the catalog and the planner apply one rule set.
"""

from __future__ import annotations

from typing import Final

from ..constants import QUERYABLE_RELATIONSHIP_KINDS
from ..dataset import Dataset
from ..measures import Measure
from ..relationships import Relationship

#: Aggregates whose result is unchanged when an input row repeats.
DUPLICATE_INSENSITIVE_AGGREGATIONS: Final[frozenset[str]] = frozenset(
    ("countDistinct", "min", "max", "argMax", "argMin")
)


def measure_filter_field(target: Dataset, field: str) -> str:
    """The target dimension a measure filter narrows, through its named filters."""

    definition = target.filters.get(field)
    return definition.field if definition is not None else field


def relationship_measure_error(
    qualified: str, relationship: Relationship, target: Dataset, measure_name: str
) -> str | None:
    """Why *qualified* cannot be aggregated through *relationship*, or None if it can."""

    if relationship.kind not in QUERYABLE_RELATIONSHIP_KINDS:
        return (
            f'Measure "{qualified}" cannot traverse {relationship.kind}: '
            "it would fan out aggregates."
        )
    measure = target.measures.get(measure_name)
    if measure is None:
        known = ", ".join(sorted(target.measures)) or "(none)"
        return (
            f'Unknown measure "{measure_name}" on relationship target "{target.name}". '
            f"Available: {known}"
        )
    if (
        relationship.kind == "belongsTo"
        and measure.aggregation not in DUPLICATE_INSENSITIVE_AGGREGATIONS
    ):
        return (
            f'Measure "{qualified}" cannot use {measure.aggregation} through belongsTo: '
            "repeated target rows would inflate the aggregation. Use a duplicate-insensitive "
            "measure or query the target dataset."
        )
    filter_fields = [measure_filter_field(target, item.field) for item in measure.filters or ()]
    for field in filter_fields:
        if "." in field or field not in target.dimensions:
            return (
                f'Measure "{qualified}" filters on "{field}", which is not a dimension of '
                f'"{target.name}" and cannot be traversed through a relationship.'
            )
    inputs = [measure.field, measure.arg_field, *filter_fields]
    if measure.sql is not None or any(
        field is not None
        and (dimension := target.dimensions.get(field)) is not None
        and dimension.sql is not None
        for field in inputs
    ):
        return (
            f'SQL-backed measure "{qualified}" or its inputs cannot be traversed through '
            "relationships."
        )
    return None


def list_relationship_measures(
    name: str, relationship: Relationship, target: Dataset
) -> dict[str, Measure]:
    """The target measures selectable as `<name>.<measure>`, keyed by qualified name."""

    return {
        f"{name}.{measure_name}": measure
        for measure_name, measure in target.measures.items()
        if relationship_measure_error(f"{name}.{measure_name}", relationship, target, measure_name)
        is None
    }

"""Shared pieces of every projection of a dataset definition.

The catalog and the deployment contract describe the same definitions in two
shapes. The parts they share — relationship nodes, limits, optional metadata,
filter operators, and which relationships may be queried — are built here once,
so the two can never disagree about them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..constants import QUERYABLE_RELATIONSHIP_KINDS, SEMANTIC_FILTER_OPERATORS
from ..query_helpers import FilterOperator
from ..relationships import Relationship

if TYPE_CHECKING:
    # Annotation-only: dataset.py validates derived measures through a module
    # that uses `metadata`, so a runtime import here would be circular.
    from ..dataset import DatasetLimits, FilterDefinition


def is_queryable(relationship: Relationship) -> bool:
    """Whether a relationship may be joined. `hasMany` would fan out aggregates."""

    return relationship.kind in QUERYABLE_RELATIONSHIP_KINDS


def relationship_node(relationship: Relationship) -> dict[str, object]:
    """`kind`, `target`, `from` and `to`, plus every key pair for a composite key.

    `from`/`to` mirror the first pair, so a reader that predates composite keys
    still sees a valid relationship.
    """

    node: dict[str, object] = {
        "kind": relationship.kind,
        "target": relationship.target,
        "from": relationship.from_field,
        "to": relationship.to_field,
    }
    if relationship.keys is not None:
        node["keys"] = [{"from": key.from_field, "to": key.to_field} for key in relationship.keys]
    return node


def limits_node(limits: DatasetLimits) -> dict[str, int]:
    """The declared limits under their protocol names; undeclared ones are omitted."""

    declared = (
        ("maxDimensions", limits.max_dimensions),
        ("maxMeasures", limits.max_measures),
        ("maxFilters", limits.max_filters),
        ("maxResultSize", limits.max_result_size),
    )
    return {key: value for key, value in declared if value is not None}


def metadata(label: str | None, description: str | None) -> dict[str, str]:
    """`label` and `description` when declared. An absent value is omitted, not null."""

    node: dict[str, str] = {}
    if label is not None:
        node["label"] = label
    if description is not None:
        node["description"] = description
    return node


def filter_operators(definition: FilterDefinition) -> list[FilterOperator]:
    """The operators a filter allows: all of them only when none are declared.

    `is None`, not truthiness: an empty tuple is a declared decision that the
    filter accepts no operator, and widening it to every operator would publish
    a capability the planner refuses.
    """

    if definition.operators is None:
        return list(SEMANTIC_FILTER_OPERATORS)
    return list(definition.operators)

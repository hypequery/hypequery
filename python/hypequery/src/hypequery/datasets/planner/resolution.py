"""Resolving a query's names against a dataset.

Every name a caller sends is resolved here before any SQL exists: a dimension
to a column or a trusted expression, a filter to the dimension it filters, a
qualified name to the relationship it traverses. An unresolvable name is caller
input, not a crash, and it fails before a statement is built rather than after.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..constants import QUERYABLE_RELATIONSHIP_KINDS
from ..dataset import Dataset
from ..dimensions import Dimension
from ..registry import DatasetRegistry
from ..relationships import Relationship
from .errors import CompiledQueryError


def is_qualified(name: str) -> bool:
    """Whether *name* addresses a relationship's field rather than this dataset's."""

    return "." in name


@dataclass(frozen=True, slots=True)
class ResolvedRelationshipField:
    """A `<relationship>.<dimension>` name, resolved to what it selects."""

    relationship_name: str
    relationship: Relationship
    target: Dataset
    dimension_name: str
    dimension: Dimension


def resolve_qualified_field(
    dataset: Dataset, name: str, *, registry: DatasetRegistry
) -> ResolvedRelationshipField:
    """Resolve one hop over a to-one relationship.

    v1 is one hop: a deeper path is rejected rather than silently truncated.
    `hasMany` is refused because joining it fans rows out and corrupts every
    aggregate in the same statement.
    """

    relationship_name, _, dimension_name = name.partition(".")
    if "." in dimension_name:
        raise CompiledQueryError(
            "input-invalid",
            f'Field "{name}" traverses more than one relationship, which is not supported.',
        )
    relationship = dataset.relationships.get(relationship_name)
    if relationship is None:
        known = ", ".join(sorted(dataset.relationships)) or "(none)"
        raise CompiledQueryError(
            "input-invalid",
            f'Unknown relationship "{relationship_name}" on dataset "{dataset.name}". '
            f"Available: {known}",
        )
    if relationship.kind not in QUERYABLE_RELATIONSHIP_KINDS:
        raise CompiledQueryError(
            "input-invalid",
            f'Relationship "{relationship_name}" is "{relationship.kind}" and cannot be '
            "queried: joining it would fan out and corrupt aggregates.",
        )
    target = registry.get(relationship.target)
    if target is None:
        raise CompiledQueryError(
            "internal",
            f'Relationship "{relationship_name}" targets unregistered dataset '
            f'"{relationship.target}".',
        )
    dimension = target.dimensions.get(dimension_name)
    if dimension is None:
        known = ", ".join(sorted(target.dimensions)) or "(none)"
        raise CompiledQueryError(
            "input-invalid",
            f'Unknown field "{dimension_name}" on dataset "{target.name}". Available: {known}',
        )
    if dimension.sql is not None:
        # The expression is written against the target's own column names and
        # is not table-qualified, so under a join it may bind to the wrong
        # table. Refusing is the honest answer until the compiler rewrites it.
        raise CompiledQueryError(
            "input-invalid",
            f'Field "{name}" is SQL-backed on "{target.name}" and cannot be traversed '
            "through a relationship.",
        )
    return ResolvedRelationshipField(
        relationship_name=relationship_name,
        relationship=relationship,
        target=target,
        dimension_name=dimension_name,
        dimension=dimension,
    )


def require_dimension(dataset: Dataset, name: str) -> Dimension:
    """Resolve a base-dataset dimension by name."""

    dimension = dataset.dimensions.get(name)
    if dimension is None:
        known = ", ".join(sorted(dataset.dimensions)) or "(none)"
        raise CompiledQueryError(
            "input-invalid",
            f'Unknown dimension "{name}" on dataset "{dataset.name}". Available: {known}',
        )
    return dimension


def resolve_filter_field(dataset: Dataset, name: str) -> str:
    """Map a named filter to the dimension it filters, or pass a dimension through."""

    definition = dataset.filters.get(name)
    return definition.field if definition is not None else name

"""Resolving a query's names against a dataset.

Every name a caller sends is resolved here before any SQL exists: a dimension
to a column or a trusted expression, a filter to the dimension it filters, a
qualified name to the relationship it traverses. An unresolvable name is caller
input, not a crash, and it fails before a statement is built rather than after.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import cast

from ..constants import QUERYABLE_RELATIONSHIP_KINDS
from ..dataset import Dataset
from ..derived_measures import DerivedMeasure
from ..dimensions import Dimension
from ..measures import Measure
from ..registry import DatasetRegistry
from ..relationships import Relationship
from ..utils.derived_measures import base_measure_names, formula_references
from ..utils.relationship_measures import relationship_measure_error
from .errors import CompiledQueryError
from .query import DatasetQuery


def is_qualified(name: str) -> bool:
    """Whether *name* addresses a relationship's field rather than this dataset's."""

    return "." in name


def physical_column(dataset: Dataset, field: str) -> str:
    """The source column *field* reads: its dimension's column, else its own name.

    A field with no dimension (a measure's raw input, say) names a column directly.
    """

    dimension = dataset.dimensions.get(field)
    if dimension is not None and dimension.column:
        return dimension.column
    return field


def selected_measure_names(dataset: Dataset, query: DatasetQuery) -> tuple[str, ...]:
    """The measures *query* selects. Omitting the list selects every base measure."""

    if query.measures is not None:
        return query.measures
    return base_measure_names(dataset.measures)


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


@dataclass(frozen=True, slots=True)
class ResolvedRelationshipMeasure:
    """A `<relationship>.<measure>` name, resolved to the target aggregate."""

    relationship_name: str
    relationship: Relationship
    target: Dataset
    measure_name: str
    measure: Measure


def resolve_relationship_measure(
    dataset: Dataset, name: str, *, registry: DatasetRegistry
) -> ResolvedRelationshipMeasure:
    """Resolve one hop to a target base aggregate whose cardinality is safe."""

    relationship_name, _, measure_name = name.partition(".")
    if "." in measure_name:
        raise CompiledQueryError(
            "input-invalid", f'Measure "{name}" must use a one-hop relationship path.'
        )
    relationship = dataset.relationships.get(relationship_name)
    if relationship is None:
        known = ", ".join(sorted(dataset.relationships)) or "(none)"
        raise CompiledQueryError(
            "input-invalid",
            f'Unknown relationship "{relationship_name}" in measure "{name}". Available: {known}',
        )
    if relationship.kind not in QUERYABLE_RELATIONSHIP_KINDS:
        raise CompiledQueryError(
            "input-invalid",
            f'Measure "{name}" cannot traverse {relationship.kind}: it would fan out aggregates.',
        )
    target = registry.get(relationship.target)
    if target is None:
        raise CompiledQueryError(
            "internal",
            f'Relationship "{relationship_name}" targets unregistered dataset '
            f'"{relationship.target}".',
        )
    error = relationship_measure_error(name, relationship, target, measure_name)
    if error is not None:
        raise CompiledQueryError("input-invalid", error)
    return ResolvedRelationshipMeasure(
        relationship_name=relationship_name,
        relationship=relationship,
        target=target,
        measure_name=measure_name,
        measure=cast(Measure, target.measures[measure_name]),
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


def references_a_relationship(dataset: Dataset, query: DatasetQuery) -> bool:
    """Whether anything in *query* addresses a field through a relationship."""

    names = [
        *query.dimensions,
        *(resolve_filter_field(dataset, item.field) for item in query.filters),
        *(order.field for order in query.order_by),
    ]
    for measure_name in selected_measure_names(dataset, query):
        names.append(measure_name)
        measure = dataset.measures.get(measure_name)
        if isinstance(measure, DerivedMeasure):
            # Only local dependencies are allowed, but their filters may traverse joins.
            pending = list(formula_references(measure.formula))
            while pending:
                dependency = dataset.measures[pending.pop()]
                if isinstance(dependency, DerivedMeasure):
                    pending.extend(formula_references(dependency.formula))
                else:
                    names.extend(
                        resolve_filter_field(dataset, item.field)
                        for item in dependency.filters or ()
                    )
        elif measure is not None:
            names.extend(
                resolve_filter_field(dataset, item.field) for item in measure.filters or ()
            )
    return any(is_qualified(name) for name in names)

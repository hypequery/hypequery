"""The fields a measure reads besides its own column: its filters, and theirs.

A measure's fixed filters may name a related dataset's field, and a derived
measure reaches whatever its dependencies do, so selecting a measure can join
a relationship the request never named.
"""

from __future__ import annotations

from collections.abc import Iterator

from ..dataset import Dataset
from ..derived_measures import DerivedMeasure
from .derived_measures import formula_references


def measure_filter_fields(dataset: Dataset, name: str) -> Iterator[str]:
    """The fields *name*'s fixed filters read, through any derived dependencies."""

    pending = [name]
    seen: set[str] = set()
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        measure = dataset.measures.get(current)
        if isinstance(measure, DerivedMeasure):
            pending.extend(formula_references(measure.formula))
        elif measure is not None:
            for item in measure.filters or ():
                definition = dataset.filters.get(item.field)
                yield definition.field if definition is not None else item.field


def measure_stays_within(dataset: Dataset, name: str, related: frozenset[str]) -> bool:
    """Whether *name*'s fixed filters reach only the relationships in *related*."""

    return all(
        field.split(".", 1)[0] in related
        for field in measure_filter_fields(dataset, name)
        if "." in field
    )

"""Which measures a measure reads (TypeScript's `measure-dependencies.ts`)."""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from ..derived_measures import DerivedMeasure
from ..time_measures import ShiftMeasure, WindowMeasure
from .derived_measures import formula_references


def measure_dependencies(definition: object) -> tuple[str, ...]:
    """The measures *definition* reads directly."""

    if isinstance(definition, DerivedMeasure):
        return formula_references(definition.formula)
    if isinstance(definition, WindowMeasure | ShiftMeasure):
        return (definition.measure,)
    return ()


def measure_dependency_names(measures: Mapping[str, object], selected: Iterable[str]) -> list[str]:
    """Every measure *selected* reads, dependencies first, each once.

    Raises ValueError on a cycle, including one through shifts and formulas.
    Unknown names are skipped; definition validation reports them.
    """

    visited: set[str] = set()
    visiting: set[str] = set()
    names: list[str] = []

    def visit(name: str) -> None:
        if name in visiting:
            raise ValueError(f'Measure "{name}" contains a dependency cycle.')
        if name in visited or name not in measures:
            return
        visiting.add(name)
        for dependency in measure_dependencies(measures[name]):
            visit(dependency)
        visiting.remove(name)
        visited.add(name)
        names.append(name)

    for name in selected:
        visit(name)
    return names


__all__ = ["measure_dependencies", "measure_dependency_names"]

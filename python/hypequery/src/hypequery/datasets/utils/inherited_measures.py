"""The base measure a window or shift chain reads (TypeScript's `inheritedBaseMeasure`)."""

from __future__ import annotations

from collections.abc import Mapping

from ..measures import Measure
from ..time_measures import ShiftMeasure, WindowMeasure


def inherited_base_measure(measures: Mapping[str, object], name: str) -> Measure | None:
    """The base measure a window or shift chain re-aggregates; None through a formula."""

    seen: set[str] = set()
    definition = measures.get(name)
    while isinstance(definition, WindowMeasure | ShiftMeasure) and name not in seen:
        seen.add(name)
        name = definition.measure
        definition = measures.get(name)
    return definition if isinstance(definition, Measure) else None


__all__ = ["inherited_base_measure"]

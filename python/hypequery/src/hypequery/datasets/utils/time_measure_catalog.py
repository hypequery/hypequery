"""Catalog metadata for window and shift measures (TypeScript's `window-catalog-metadata.ts`)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from ..derived_measures import DerivedMeasure
from ..time_measures import ShiftMeasure, WindowMeasure
from .derived_measures import formula_references
from .time_axis import supports_shift_grain, window_grain_error


def time_measure_metadata(definition: WindowMeasure | ShiftMeasure) -> dict[str, object]:
    if isinstance(definition, ShiftMeasure):
        return {
            "kind": "shift",
            "measure": definition.measure,
            "interval": {"amount": definition.interval.amount, "unit": definition.interval.unit},
            "requiresTimeRange": True,
        }
    metadata: dict[str, object] = {
        "kind": "window",
        "measure": definition.measure,
        "requiresTimeRange": True,
    }
    if definition.trailing is not None:
        metadata["trailing"] = {
            "amount": definition.trailing.amount,
            "unit": definition.trailing.unit,
        }
    if definition.to_date is not None:
        metadata["toDate"] = definition.to_date
    if definition.cumulative:
        metadata["cumulative"] = True
    return metadata


def measure_supported_grains(
    measures: Mapping[str, object], name: str, grains: Sequence[str]
) -> list[str]:
    """The dataset's grains a measure can be queried at (TypeScript's `measureSupportedGrains`)."""

    definition = measures.get(name)
    if isinstance(definition, ShiftMeasure):
        return [
            grain
            for grain in measure_supported_grains(measures, definition.measure, grains)
            if supports_shift_grain(definition.interval, grain)
        ]
    if isinstance(definition, WindowMeasure):
        return [grain for grain in grains if window_grain_error(name, definition, grain) is None]
    if not isinstance(definition, DerivedMeasure):
        return list(grains)
    inputs = [
        measure_supported_grains(measures, reference, grains)
        for reference in formula_references(definition.formula)
    ]
    return [grain for grain in grains if all(grain in supported for supported in inputs)]


def uses_time_measure(measures: Mapping[str, object], name: str) -> bool:
    """Whether *name*, or any measure its formula reads, is a window or shift measure."""

    definition = measures.get(name)
    if isinstance(definition, WindowMeasure | ShiftMeasure):
        return True
    if isinstance(definition, DerivedMeasure):
        return any(
            uses_time_measure(measures, reference)
            for reference in formula_references(definition.formula)
            if reference != name
        )
    return False

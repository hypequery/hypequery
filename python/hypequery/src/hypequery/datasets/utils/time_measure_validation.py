"""Definition-time rules for window and shift measures (RFC 0015)."""

from __future__ import annotations

from collections.abc import Mapping

from ...protocol.deployment_primitives import CUMULATIVE_AGGREGATIONS
from ..measures import Measure
from ..time_measures import ShiftMeasure, WindowMeasure
from .measure_dependencies import measure_dependency_names


def time_measure_errors(measures: Mapping[str, object], time_key: str | None) -> str | None:
    """Why a window or shift measure is invalid, or None. Mirrors TypeScript's validators.

    A window wraps a base measure. A shift may wrap any measure: a base, a
    window, a formula or another shift.
    """

    for name, definition in measures.items():
        if not isinstance(definition, WindowMeasure | ShiftMeasure):
            continue
        kind = "window" if isinstance(definition, WindowMeasure) else "shift"
        if time_key is None:
            return f'{kind} measure "{name}" requires the dataset to define time_key'
        base = measures.get(definition.measure)
        if isinstance(definition, ShiftMeasure):
            if base is None:
                return f'shift measure "{name}" references missing measure "{definition.measure}"'
            continue
        if not isinstance(base, Measure):
            return (
                f'window measure "{name}" must wrap a base measure; '
                f'"{definition.measure}" is not one'
            )
        if definition.cumulative and base.aggregation not in CUMULATIVE_AGGREGATIONS:
            return (
                f'window measure "{name}" cannot accumulate {base.aggregation}; '
                "use sum, count, min or max"
            )
    try:
        measure_dependency_names(measures, measures)
    except ValueError as error:
        return str(error)
    return None

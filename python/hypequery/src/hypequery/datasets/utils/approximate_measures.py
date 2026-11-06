"""Which measures return estimates.

Catalogs mark them `approximate` so a consumer, and in particular an agent, can
say a value is an estimate (RFC 0015). Mirrors
`packages/datasets/src/utils/approximate-measures.ts`.
"""

from __future__ import annotations

from collections.abc import Mapping

from ...protocol.deployment_primitives import APPROXIMATE_STATE_FUNCTIONS
from ..derived_measures import DerivedMeasure
from ..measures import Measure
from .derived_measures import formula_references

#: Aggregations whose result is an estimate.
APPROXIMATE_AGGREGATIONS = frozenset({"approxCountDistinct"})


def is_approximate_base_measure(measure: Measure) -> bool:
    """Approximate by aggregation, or by merging estimating states (`uniqMerge`)."""

    return measure.aggregation in APPROXIMATE_AGGREGATIONS or (
        measure.aggregation == "merge" and measure.state_function in APPROXIMATE_STATE_FUNCTIONS
    )


def is_approximate_measure(measures: Mapping[str, Measure | DerivedMeasure], name: str) -> bool:
    """Whether *name*, or any measure its formula reads, returns an estimate."""

    definition = measures.get(name)
    if isinstance(definition, Measure):
        return is_approximate_base_measure(definition)
    if isinstance(definition, DerivedMeasure):
        return any(
            is_approximate_measure(measures, reference)
            for reference in formula_references(definition.formula)
            if reference != name
        )
    return False

"""Hold an endpoint's queries to the relationships it chose to expose.

An endpoint's policy gates the endpoint, not the datasets a relationship
reaches. Without this, a caller refused by the related dataset's own endpoint
could still read its fields through any dataset that declares the relationship.
"""

from __future__ import annotations

from collections.abc import Iterable

from ...datasets import Dataset
from ...datasets.planner import DatasetQuery
from ...datasets.planner.resolution import (
    is_qualified,
    resolve_filter_field,
    selected_measure_names,
)
from ...datasets.utils.derived_measures import base_measure_names
from ...datasets.utils.measure_references import measure_filter_fields, measure_stays_within
from ..errors import ServeError


def checked_related(dataset: Dataset, include_related: Iterable[str]) -> frozenset[str]:
    """*include_related* as a set, refusing names that are not relationships."""

    if isinstance(include_related, str):
        raise TypeError("include_related must be a collection of relationship names")
    names = frozenset(include_related)
    unknown = sorted(names - set(dataset.relationships))
    if unknown:
        raise ValueError(
            f"include_related names unknown relationships on {dataset.name!r}: {', '.join(unknown)}"
        )
    return names


def default_measures(dataset: Dataset, include_related: frozenset[str]) -> tuple[str, ...] | None:
    """The base measures an omitted list selects here, or None when that is all of them.

    A base measure whose fixed filters join an excluded relationship is left
    out, as the client contract leaves it out of the endpoint's measures.
    """

    names = base_measure_names(dataset.measures)
    served = tuple(name for name in names if measure_stays_within(dataset, name, include_related))
    return None if served == names else served


def refuse_unservable_metric(
    dataset: Dataset, measure: str, include_related: frozenset[str]
) -> None:
    if not measure_stays_within(dataset, measure, include_related):
        raise ValueError(
            f"metric measure {measure!r} filters through a relationship missing from "
            "include_related"
        )


def _refused(dataset: Dataset, name: str, include_related: frozenset[str]) -> bool:
    if not is_qualified(name):
        return False
    relation = name.split(".", 1)[0]
    return relation in dataset.relationships and relation not in include_related


def refuse_unlisted_related(
    dataset: Dataset, query: DatasetQuery, include_related: frozenset[str]
) -> None:
    requested = [
        *query.dimensions,
        *(resolve_filter_field(dataset, item.field) for item in query.filters),
        *(order.field for order in query.order_by),
        *selected_measure_names(dataset, query),
    ]
    for name in requested:
        if _refused(dataset, name, include_related):
            raise ServeError(
                400, "VALIDATION_ERROR", f'Field "{name}" is not available on this endpoint.'
            )
    # A measure's fixed filters join their relationship too.
    for measure in selected_measure_names(dataset, query):
        for name in measure_filter_fields(dataset, measure):
            if _refused(dataset, name, include_related):
                raise ServeError(
                    400,
                    "VALIDATION_ERROR",
                    f'Measure "{measure}" filters on "{name}", which is not available on '
                    "this endpoint.",
                )

"""Hold an endpoint's queries to the relationships it chose to expose.

An endpoint's policy gates the endpoint, not the datasets a relationship
reaches. Without this, a caller refused by the related dataset's own endpoint
could still read its fields through any dataset that declares the relationship.
"""

from __future__ import annotations

from collections.abc import Iterable, Iterator

from ...datasets import Dataset
from ...datasets.planner import DatasetQuery
from ...datasets.planner.resolution import is_qualified
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


def _referenced(dataset: Dataset, query: DatasetQuery) -> Iterator[str]:
    yield from query.dimensions
    yield from query.measures or ()
    for item in query.filters:
        # A named filter stands for the field it was defined on.
        definition = dataset.filters.get(item.field)
        yield definition.field if definition is not None else item.field
    yield from (order.field for order in query.order_by)
    yield from (condition.measure for condition in query.having)


def refuse_unlisted_related(
    dataset: Dataset, query: DatasetQuery, include_related: frozenset[str]
) -> None:
    for name in _referenced(dataset, query):
        if not is_qualified(name):
            continue
        relation = name.split(".", 1)[0]
        if relation in dataset.relationships and relation not in include_related:
            raise ServeError(
                400, "VALIDATION_ERROR", f'Field "{name}" is not available on this endpoint.'
            )

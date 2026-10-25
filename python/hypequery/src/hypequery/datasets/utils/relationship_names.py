"""The relationships an endpoint exposes, as a checked set of names.

Serve's include_related and an offline ClientEndpointDefinition's related must
accept and refuse the same names, so both describe the same endpoint.
"""

from __future__ import annotations

from collections.abc import Iterable

from ..dataset import Dataset


def checked_relationship_names(
    dataset: Dataset, names: Iterable[str], *, argument: str
) -> frozenset[str]:
    """*names* as a set, refusing a bare string and names that are not relationships."""

    if isinstance(names, str):
        raise TypeError(f"{argument} must be a collection of relationship names")
    checked = frozenset(names)
    unknown = sorted(checked - set(dataset.relationships))
    if unknown:
        raise ValueError(
            f"{argument} names unknown relationships on {dataset.name!r}: {', '.join(unknown)}"
        )
    return checked

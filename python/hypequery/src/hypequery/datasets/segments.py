"""Named row filters a query selects by name (RFC 0015 segments)."""

from __future__ import annotations

from pydantic import field_validator

from ._base import DefinitionModel
from .query_helpers import Filter


class Segment(DefinitionModel):
    """Author-defined filters, AND-ed, over the dataset's own dimensions.

    A segment may use a dimension that is not exposed as a filter: the filter
    allow-list governs what a caller may construct, not what an author may
    declare. It may not traverse a relationship or constrain the tenant
    column, which only trusted runtime context scopes.
    """

    filters: tuple[Filter, ...]
    label: str | None = None
    description: str | None = None

    @field_validator("filters")
    @classmethod
    def _non_empty(cls, value: tuple[Filter, ...]) -> tuple[Filter, ...]:
        if not value:
            raise ValueError("a segment needs at least one filter")
        return value


def segment(*filters: Filter, label: str | None = None, description: str | None = None) -> Segment:
    """`segment(filter.eq("status", "paid"))`: a named row filter for `dataset(segments=...)`."""

    return Segment(filters=filters, label=label, description=description)

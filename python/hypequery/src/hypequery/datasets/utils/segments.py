"""Validate declared segments against the dataset that owns them (RFC 0015)."""

from __future__ import annotations

from collections.abc import Mapping

from ..dimensions import Dimension
from ..segments import Segment


def segment_errors(
    segments: Mapping[str, Segment],
    dimensions: Mapping[str, Dimension],
    tenant_key: str | None,
) -> str | None:
    """Why a declared segment is invalid, or None. Mirrors TypeScript's `normalizeSegments`."""

    # Imported here: the planner package imports the dataset model.
    from ..planner.errors import CompiledQueryError
    from ..planner.filter_validation import validate_filter_value

    for name, declared in segments.items():
        for item in declared.filters:
            dimension = dimensions.get(item.field)
            if dimension is None:
                return (
                    f'segment "{name}": "{item.field}" is not a dimension of this dataset; '
                    "segments cannot use relationships"
                )
            column = dimension.column or item.field
            if tenant_key is not None and tenant_key in (column, item.field):
                return (
                    f'segment "{name}": "{item.field}" is the tenant column, which only '
                    "runtime tenant scoping may constrain"
                )
            try:
                validate_filter_value(item, dimension.field_type)
            except CompiledQueryError as error:
                return f'segment "{name}": {error.message}'
    return None

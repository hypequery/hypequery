"""Validate semantic filter values before assigning ClickHouse parameter types."""

from __future__ import annotations

import math
from typing import cast

from ..dimensions import DimensionType
from ..query_helpers import Filter
from .errors import CompiledQueryError


def _matches_field_type(field_type: DimensionType, value: object) -> bool:
    if field_type in ("string", "timestamp"):
        return type(value) is str
    if field_type == "boolean":
        return type(value) is bool
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(cast(int | float, value))
    except OverflowError:
        return False


def validate_filter_value(filter_value: Filter, field_type: DimensionType) -> None:
    """Reject values or operators that do not make sense for the field type."""

    operator = filter_value.operator
    value = filter_value.value
    name = filter_value.field
    if operator in ("in", "notIn", "between"):
        if type(value) not in (list, tuple):
            raise CompiledQueryError("input-invalid", f'Filter "{name}" needs a list of values.')
        items = cast(list[object] | tuple[object, ...], value)
        expected = 2 if operator == "between" else None
        if (expected is not None and len(items) != expected) or (expected is None and not items):
            raise CompiledQueryError("input-invalid", f'Filter "{name}" has the wrong list length.')
        if not all(_matches_field_type(field_type, item) for item in items):
            raise CompiledQueryError(
                "input-invalid", f'Filter "{name}" expects {field_type} values.'
            )
        return
    if operator == "like" and field_type not in ("string", "timestamp"):
        raise CompiledQueryError(
            "input-invalid", f'Filter "{name}" cannot use like with a {field_type} field.'
        )
    if operator in ("gt", "gte", "lt", "lte") and field_type == "boolean":
        raise CompiledQueryError("input-invalid", f'Filter "{name}" cannot order a boolean field.')
    if not _matches_field_type(field_type, value):
        raise CompiledQueryError("input-invalid", f'Filter "{name}" expects a {field_type} value.')

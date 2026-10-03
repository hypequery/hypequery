"""Decode JSON collections into strict definition models without coercion."""

from __future__ import annotations

from pydantic import ValidationError

from ...datasets.planner import CompiledQueryError
from ...datasets.query_helpers import Filter, Order


def decode_filters(values: list[dict[str, object]]) -> tuple[Filter, ...]:
    try:
        return tuple(Filter.model_validate(value) for value in values)
    except ValidationError:
        raise CompiledQueryError("input-invalid", "Invalid dataset filter.") from None


def decode_orders(values: list[dict[str, object]]) -> tuple[Order, ...]:
    try:
        return tuple(Order.model_validate(value) for value in values)
    except ValidationError:
        raise CompiledQueryError("input-invalid", "Invalid dataset ordering.") from None

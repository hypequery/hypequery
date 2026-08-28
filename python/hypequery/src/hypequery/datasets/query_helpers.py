"""Filter and ordering data helpers for semantic definitions."""

from __future__ import annotations

from typing import Literal, TypeAlias

from pydantic import JsonValue, field_validator

from ._base import DefinitionModel
from .validation import validate_qualified_identifier

FilterOperator: TypeAlias = Literal[
    "eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "between", "like"
]
OrderDirection: TypeAlias = Literal["asc", "desc"]


class Filter(DefinitionModel):
    """One immutable semantic filter value."""

    field: str
    operator: FilterOperator
    value: JsonValue

    @field_validator("field")
    @classmethod
    def _valid_field(cls, value: str) -> str:
        return validate_qualified_identifier(value)


class Order(DefinitionModel):
    """One immutable semantic ordering value."""

    field: str
    direction: OrderDirection

    @field_validator("field")
    @classmethod
    def _valid_field(cls, value: str) -> str:
        return validate_qualified_identifier(value)


def eq(field: str, value: JsonValue) -> Filter:
    return Filter(field=field, operator="eq", value=value)


def neq(field: str, value: JsonValue) -> Filter:
    return Filter(field=field, operator="neq", value=value)


def gt(field: str, value: JsonValue) -> Filter:
    return Filter(field=field, operator="gt", value=value)


def gte(field: str, value: JsonValue) -> Filter:
    return Filter(field=field, operator="gte", value=value)


def lt(field: str, value: JsonValue) -> Filter:
    return Filter(field=field, operator="lt", value=value)


def lte(field: str, value: JsonValue) -> Filter:
    return Filter(field=field, operator="lte", value=value)


def in_list(field: str, values: list[JsonValue]) -> Filter:
    return Filter(field=field, operator="in", value=values)


def not_in_list(field: str, values: list[JsonValue]) -> Filter:
    return Filter(field=field, operator="notIn", value=values)


def between(field: str, lower: JsonValue, upper: JsonValue) -> Filter:
    return Filter(field=field, operator="between", value=[lower, upper])


def like(field: str, value: str) -> Filter:
    return Filter(field=field, operator="like", value=value)


def asc(field: str) -> Order:
    return Order(field=field, direction="asc")


def desc(field: str) -> Order:
    return Order(field=field, direction="desc")

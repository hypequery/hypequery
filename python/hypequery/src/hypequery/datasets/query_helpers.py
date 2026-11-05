"""Filter and ordering data helpers for semantic definitions."""

from __future__ import annotations

from typing import Any, Literal, TypeAlias

from pydantic import (
    JsonValue,
    SerializerFunctionWrapHandler,
    field_serializer,
    field_validator,
    model_serializer,
    model_validator,
)

from ._base import DefinitionModel
from .immutability import freeze_json_value, thaw_json_value
from .validation import validate_qualified_identifier

FilterOperator: TypeAlias = Literal[
    "eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "between", "like", "isNull", "isNotNull"
]
#: Comparisons with no right-hand value (RFC 0023).
NULL_CHECK_OPERATORS: frozenset[str] = frozenset({"isNull", "isNotNull"})
OrderDirection: TypeAlias = Literal["asc", "desc"]
#: `like` is excluded: a having condition compares an aggregated numeric value.
HavingOperator: TypeAlias = Literal["eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "between"]


class Filter(DefinitionModel):
    """One immutable semantic filter value.

    A null check (`isNull`, `isNotNull`) names no value, not even `None`;
    every other operator requires one.
    """

    field: str
    operator: FilterOperator
    value: object = None

    @field_validator("field")
    @classmethod
    def _valid_field(cls, value: str) -> str:
        return validate_qualified_identifier(value)

    @field_validator("value", mode="before")
    @classmethod
    def _frozen_value(cls, value: object) -> object:
        return freeze_json_value(value)

    @model_validator(mode="after")
    def _value_matches_operator(self) -> Filter:
        given = "value" in self.model_fields_set
        if self.operator in NULL_CHECK_OPERATORS and given:
            raise ValueError(f"{self.operator} takes no value")
        if self.operator not in NULL_CHECK_OPERATORS and not given:
            raise ValueError(f"{self.operator} needs a value")
        return self

    @field_serializer("value")
    def _serialize_value(self, value: object) -> object:
        return thaw_json_value(value)

    @model_serializer(mode="wrap")
    def _serialize(self, handler: SerializerFunctionWrapHandler) -> Any:
        data = handler(self)
        if self.operator in NULL_CHECK_OPERATORS and isinstance(data, dict):
            data.pop("value", None)
        return data

    @property
    def is_null_check(self) -> bool:
        return self.operator in NULL_CHECK_OPERATORS

    def with_field(self, field: str) -> Filter:
        """The same comparison on another field, validated afresh."""

        if self.is_null_check:
            return Filter(field=field, operator=self.operator)
        return Filter(field=field, operator=self.operator, value=self.value)


class HavingCondition(DefinitionModel):
    """A condition on an aggregated measure value, applied after grouping.

    `measure` must be one the query selects. Values are finite numbers, a pair
    for `between` and a non-empty list for `in`/`notIn`; the planner checks
    them and always binds them as parameters.
    """

    measure: str
    operator: HavingOperator
    value: object

    @field_validator("measure")
    @classmethod
    def _valid_measure(cls, value: str) -> str:
        return validate_qualified_identifier(value)

    @field_validator("value", mode="before")
    @classmethod
    def _frozen_value(cls, value: object) -> object:
        return freeze_json_value(value)

    @field_serializer("value")
    def _serialize_value(self, value: object) -> object:
        return thaw_json_value(value)


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


def is_null(field: str) -> Filter:
    """`field IS NULL`. Callers may use it only on filters that list it (RFC 0023)."""

    return Filter(field=field, operator="isNull")


def is_not_null(field: str) -> Filter:
    """`field IS NOT NULL`. Callers may use it only on filters that list it (RFC 0023)."""

    return Filter(field=field, operator="isNotNull")


def asc(field: str) -> Order:
    return Order(field=field, direction="asc")


def desc(field: str) -> Order:
    return Order(field=field, direction="desc")


class _FilterHelpers:
    """Filter helper namespace, matching TypeScript with Python spelling."""

    eq = staticmethod(eq)
    neq = staticmethod(neq)
    gt = staticmethod(gt)
    gte = staticmethod(gte)
    lt = staticmethod(lt)
    lte = staticmethod(lte)
    in_list = staticmethod(in_list)
    not_in_list = staticmethod(not_in_list)
    between = staticmethod(between)
    like = staticmethod(like)
    is_null = staticmethod(is_null)
    is_not_null = staticmethod(is_not_null)


class _OrderHelpers:
    """Ordering helper namespace matching TypeScript."""

    asc = staticmethod(asc)
    desc = staticmethod(desc)


filter = _FilterHelpers()  # noqa: A001
order = _OrderHelpers()

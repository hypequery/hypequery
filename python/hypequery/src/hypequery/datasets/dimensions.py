"""Dimension definition model and helper."""

from __future__ import annotations

from typing import Literal, TypeAlias

from pydantic import field_validator

from ._base import DefinitionModel
from .validation import validate_non_empty, validate_qualified_identifier

DimensionType: TypeAlias = Literal["string", "number", "boolean", "timestamp"]


class Dimension(DefinitionModel):
    """A logical dimension over a physical column or trusted expression."""

    field_type: DimensionType
    label: str | None = None
    description: str | None = None
    column: str | None = None
    sql: str | None = None
    dependencies: tuple[str, ...] | None = None
    filterable: bool | None = None
    groupable: bool | None = None

    @field_validator("column", "sql")
    @classmethod
    def _non_empty_text(cls, value: str | None, info: object) -> str | None:
        if value is None:
            return None
        field_name = getattr(info, "field_name", "value")
        return validate_non_empty(value, field=str(field_name))

    @field_validator("dependencies")
    @classmethod
    def _valid_dependencies(cls, value: tuple[str, ...] | None) -> tuple[str, ...] | None:
        if value is None:
            return None
        return tuple(validate_qualified_identifier(item) for item in value)


def dimension(
    field_type: DimensionType,
    *,
    label: str | None = None,
    description: str | None = None,
    column: str | None = None,
    sql: str | None = None,
    dependencies: tuple[str, ...] | None = None,
    filterable: bool | None = None,
    groupable: bool | None = None,
) -> Dimension:
    """Define a typed dataset dimension."""

    return Dimension(
        field_type=field_type,
        label=label,
        description=description,
        column=column,
        sql=sql,
        dependencies=dependencies,
        filterable=filterable,
        groupable=groupable,
    )

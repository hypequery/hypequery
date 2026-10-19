"""Dimension definition model and helper."""

from __future__ import annotations

from typing import Literal, TypeAlias, TypedDict, Unpack

from pydantic import ValidationInfo, field_validator

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
    def _non_empty_text(cls, value: str | None, info: ValidationInfo) -> str | None:
        if value is None:
            return None
        return validate_non_empty(value, field=info.field_name or "value")

    @field_validator("dependencies")
    @classmethod
    def _valid_dependencies(cls, value: tuple[str, ...] | None) -> tuple[str, ...] | None:
        if value is None:
            return None
        return tuple(validate_qualified_identifier(item) for item in value)


def _create_dimension(
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


class _DimensionOptions(TypedDict, total=False):
    label: str | None
    description: str | None
    column: str | None
    sql: str | None
    dependencies: tuple[str, ...] | None
    filterable: bool | None
    groupable: bool | None


class _DimensionHelpers:
    """Typed authoring helpers matching the TypeScript dimension namespace."""

    __call__ = staticmethod(_create_dimension)

    @staticmethod
    def string(**options: Unpack[_DimensionOptions]) -> Dimension:
        """Define a string dimension."""
        return _create_dimension("string", **options)

    @staticmethod
    def number(**options: Unpack[_DimensionOptions]) -> Dimension:
        """Define a number dimension."""
        return _create_dimension("number", **options)

    @staticmethod
    def boolean(**options: Unpack[_DimensionOptions]) -> Dimension:
        """Define a boolean dimension."""
        return _create_dimension("boolean", **options)

    @staticmethod
    def timestamp(**options: Unpack[_DimensionOptions]) -> Dimension:
        """Define a timestamp dimension."""
        return _create_dimension("timestamp", **options)


dimension = _DimensionHelpers()

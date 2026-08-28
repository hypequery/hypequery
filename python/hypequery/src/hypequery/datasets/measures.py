"""Measure definition model and helper."""

from __future__ import annotations

from pydantic import field_validator, model_validator

from .aggregations import Aggregation
from .query_helpers import Filter
from .validation import validate_non_empty, validate_qualified_identifier


class Measure(Aggregation):
    """A named dataset measure backed by an aggregation."""

    sql: str | None = None
    dependencies: tuple[str, ...] | None = None
    label: str | None = None
    description: str | None = None
    filters: tuple[Filter, ...] | None = None

    @field_validator("sql")
    @classmethod
    def _non_empty_sql(cls, value: str | None) -> str | None:
        return None if value is None else validate_non_empty(value, field="sql")

    @field_validator("dependencies")
    @classmethod
    def _valid_dependencies(cls, value: tuple[str, ...] | None) -> tuple[str, ...] | None:
        if value is None:
            return None
        return tuple(validate_qualified_identifier(item) for item in value)

    @model_validator(mode="after")
    def _arg_measures_have_no_filters(self) -> Measure:
        if self.aggregation in ("argMax", "argMin") and self.filters:
            raise ValueError(f"measure filters are not supported on {self.aggregation}")
        return self


def measure(
    value: Aggregation,
    *,
    sql: str | None = None,
    dependencies: tuple[str, ...] | None = None,
    label: str | None = None,
    description: str | None = None,
    filters: tuple[Filter, ...] | None = None,
) -> Measure:
    """Attach measure metadata to a normalized aggregation."""

    return Measure(
        aggregation=value.aggregation,
        field=value.field,
        arg_field=value.arg_field,
        level=value.level,
        sql=sql,
        dependencies=dependencies,
        label=label,
        description=description,
        filters=filters,
    )

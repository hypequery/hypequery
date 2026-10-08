"""Measure definition model and helper."""

from __future__ import annotations

from typing import TypedDict, Unpack

from pydantic import field_validator, model_validator

from . import aggregations
from .aggregations import Aggregation
from .derived_measures import DerivedMeasure
from .formulas import Formula
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


def _create_measure(
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


class _MeasureOptions(TypedDict, total=False):
    sql: str | None
    dependencies: tuple[str, ...] | None
    label: str | None
    description: str | None
    filters: tuple[Filter, ...] | None


class _MeasureHelpers:
    """Typed base-measure helpers matching TypeScript, with Python spelling."""

    __call__ = staticmethod(_create_measure)

    @staticmethod
    def derived(
        formula: Formula, *, label: str | None = None, description: str | None = None
    ) -> DerivedMeasure:
        return DerivedMeasure(formula=formula, label=label, description=description)

    @staticmethod
    def sum(field: str, **options: Unpack[_MeasureOptions]) -> Measure:
        """Define a sum measure."""
        return _create_measure(aggregations.sum(field), **options)

    @staticmethod
    def count(field: str, **options: Unpack[_MeasureOptions]) -> Measure:
        """Define a count measure."""
        return _create_measure(aggregations.count(field), **options)

    @staticmethod
    def count_distinct(field: str, **options: Unpack[_MeasureOptions]) -> Measure:
        """Define a count_distinct measure."""
        return _create_measure(aggregations.count_distinct(field), **options)

    @staticmethod
    def avg(field: str, **options: Unpack[_MeasureOptions]) -> Measure:
        """Define a avg measure."""
        return _create_measure(aggregations.avg(field), **options)

    @staticmethod
    def min(field: str, **options: Unpack[_MeasureOptions]) -> Measure:
        """Define a min measure."""
        return _create_measure(aggregations.min(field), **options)

    @staticmethod
    def max(field: str, **options: Unpack[_MeasureOptions]) -> Measure:
        """Define a max measure."""
        return _create_measure(aggregations.max(field), **options)

    @staticmethod
    def median(field: str, **options: Unpack[_MeasureOptions]) -> Measure:
        """Define a median measure."""
        return _create_measure(aggregations.median(field), **options)

    @staticmethod
    def stddev(field: str, **options: Unpack[_MeasureOptions]) -> Measure:
        """Define a stddev measure."""
        return _create_measure(aggregations.stddev(field), **options)

    @staticmethod
    def variance(field: str, **options: Unpack[_MeasureOptions]) -> Measure:
        """Define a variance measure."""
        return _create_measure(aggregations.variance(field), **options)

    @staticmethod
    def percentile(field: str, level: float, **options: Unpack[_MeasureOptions]) -> Measure:
        """Define a percentile measure."""
        return _create_measure(aggregations.percentile(field, level), **options)

    @staticmethod
    def arg_max(field: str, by: str, **options: Unpack[_MeasureOptions]) -> Measure:
        """Define a arg_max measure."""
        return _create_measure(aggregations.arg_max(field, by), **options)

    @staticmethod
    def arg_min(field: str, by: str, **options: Unpack[_MeasureOptions]) -> Measure:
        """Define a arg_min measure."""
        return _create_measure(aggregations.arg_min(field, by), **options)


measure = _MeasureHelpers()

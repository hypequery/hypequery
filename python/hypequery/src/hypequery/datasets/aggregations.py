"""Aggregation definition models and Pythonic authoring helpers."""

from __future__ import annotations

from typing import Literal, TypeAlias

from pydantic import field_validator, model_validator

from ..protocol.deployment_primitives import AGGREGATE_STATE_FUNCTIONS
from ._base import DefinitionModel
from .validation import validate_identifier

AggregationType: TypeAlias = Literal[
    "sum",
    "count",
    "countDistinct",
    "approxCountDistinct",
    "avg",
    "min",
    "max",
    "argMax",
    "argMin",
    "percentile",
    "stddev",
    "variance",
    "merge",
]


class Aggregation(DefinitionModel):
    """A normalized aggregation specification."""

    aggregation: AggregationType
    field: str
    arg_field: str | None = None
    level: float | None = None
    #: For `merge`: the function whose stored states the field holds (RFC 0022).
    state_function: str | None = None

    @field_validator("field", "arg_field")
    @classmethod
    def _valid_field(cls, value: str | None) -> str | None:
        return None if value is None else validate_identifier(value)

    @model_validator(mode="after")
    def _valid_shape(self) -> Aggregation:
        if self.aggregation in ("argMax", "argMin"):
            if self.arg_field is None:
                raise ValueError(f"{self.aggregation} requires an arg_field")
        elif self.arg_field is not None:
            raise ValueError(f"{self.aggregation} does not accept an arg_field")

        if self.aggregation == "percentile":
            if self.level is None or not 0 <= self.level <= 1:
                raise ValueError("percentile level must be between 0 and 1")
        elif self.level is not None:
            raise ValueError(f"{self.aggregation} does not accept a level")

        if self.aggregation == "merge":
            # Interpolated into SQL as `<fn>Merge(field)`: only names from the list.
            if self.state_function not in AGGREGATE_STATE_FUNCTIONS:
                supported = ", ".join(sorted(AGGREGATE_STATE_FUNCTIONS))
                raise ValueError(
                    f"merge needs a supported state_function, not {self.state_function!r}. "
                    f"Supported: {supported}"
                )
        elif self.state_function is not None:
            raise ValueError(f"{self.aggregation} does not accept a state_function")
        return self


def sum(field: str) -> Aggregation:  # noqa: A001
    return Aggregation(aggregation="sum", field=field)


def count(field: str) -> Aggregation:
    return Aggregation(aggregation="count", field=field)


def count_distinct(field: str) -> Aggregation:
    return Aggregation(aggregation="countDistinct", field=field)


def approx_count_distinct(field: str) -> Aggregation:
    """An estimated distinct count: ClickHouse `uniq`, approximate by design."""

    return Aggregation(aggregation="approxCountDistinct", field=field)


def avg(field: str) -> Aggregation:
    return Aggregation(aggregation="avg", field=field)


def min(field: str) -> Aggregation:  # noqa: A001
    return Aggregation(aggregation="min", field=field)


def max(field: str) -> Aggregation:  # noqa: A001
    return Aggregation(aggregation="max", field=field)


def percentile(field: str, level: float) -> Aggregation:
    return Aggregation(aggregation="percentile", field=field, level=level)


def median(field: str) -> Aggregation:
    return percentile(field, 0.5)


def arg_max(field: str, by: str) -> Aggregation:
    return Aggregation(aggregation="argMax", field=field, arg_field=by)


def arg_min(field: str, by: str) -> Aggregation:
    return Aggregation(aggregation="argMin", field=field, arg_field=by)


def merge(state_function: str, field: str) -> Aggregation:
    """Finalize stored aggregate states: `merge("uniq", "users")` is `uniqMerge(users)`.

    *field* is an `AggregateFunction(<state_function>, ...)` column, as an
    AggregatingMergeTree table or its materialized view stores (RFC 0022).
    """

    return Aggregation(aggregation="merge", field=field, state_function=state_function)


def stddev(field: str) -> Aggregation:
    return Aggregation(aggregation="stddev", field=field)


def variance(field: str) -> Aggregation:
    return Aggregation(aggregation="variance", field=field)

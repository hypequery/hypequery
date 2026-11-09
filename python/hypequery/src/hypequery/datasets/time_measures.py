"""Window and shift measures: a base measure re-aggregated along the time axis (RFC 0015).

A window re-aggregates a base measure's rows over a trailing interval
(`trailing`), from the start of a coarser calendar bucket (`to_date`), or over
all history up to each bucket (`cumulative`). A shift evaluates a base measure
over an earlier aligned bucket, for period-over-period comparison. Both need a
`by` grain and exactly one bounded range on the time key.
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator, model_validator

from ._base import DefinitionModel
from .validation import validate_identifier

TimeGrainName = Literal["minute", "hour", "day", "week", "month", "quarter", "year"]


class MeasureTimeInterval(DefinitionModel):
    """A positive whole-number interval of one grain."""

    amount: int = Field(ge=1, le=2**53 - 1)
    unit: TimeGrainName


class WindowMeasure(DefinitionModel):
    """Exactly one of `trailing`, `to_date` or `cumulative` over a base measure."""

    kind: Literal["window"] = "window"
    measure: str
    trailing: MeasureTimeInterval | None = None
    to_date: TimeGrainName | None = None
    cumulative: Literal[True] | None = None
    label: str | None = None
    description: str | None = None

    @field_validator("measure")
    @classmethod
    def _valid_measure(cls, value: str) -> str:
        return validate_identifier(value)

    @model_validator(mode="after")
    def _one_mode(self) -> WindowMeasure:
        modes = [
            mode for mode in (self.trailing, self.to_date, self.cumulative) if mode is not None
        ]
        if len(modes) != 1:
            raise ValueError(
                "a window measure declares exactly one of trailing, to_date or cumulative"
            )
        if self.to_date == "minute":
            raise ValueError("to_date needs a supported grain coarser than minute")
        return self


class ShiftMeasure(DefinitionModel):
    """A base measure evaluated over an earlier aligned bucket."""

    kind: Literal["shift"] = "shift"
    measure: str
    interval: MeasureTimeInterval
    label: str | None = None
    description: str | None = None

    @field_validator("measure")
    @classmethod
    def _valid_measure(cls, value: str) -> str:
        return validate_identifier(value)


TimeMeasure = WindowMeasure | ShiftMeasure

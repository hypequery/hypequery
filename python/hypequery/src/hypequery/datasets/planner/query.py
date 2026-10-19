"""The semantic query a caller sends.

Unlike a definition, this is request data, so it forbids unknown keys and
carries no SQL, no settings, and no tenant: those are the trusted planner's,
and a field that let a request supply one would be the whole capability
boundary undone.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..constants import SUPPORTED_TIME_GRAINS
from ..query_helpers import Filter, HavingCondition, Order
from ..utils.query_timezone import validate_timezone

TimeGrain = str


class DatasetQuery(BaseModel):
    """A grouped aggregation over one dataset."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    timezone: str | None = None

    @field_validator("timezone")
    @classmethod
    def _timezone(cls, value: str | None) -> str | None:
        return None if value is None else validate_timezone(value)

    dimensions: tuple[str, ...] = ()
    measures: tuple[str, ...] | None = None
    filters: tuple[Filter, ...] = ()
    #: Conditions on aggregated measure values, AND-ed and applied after grouping.
    having: tuple[HavingCondition, ...] = ()
    by: TimeGrain | None = None
    order_by: tuple[Order, ...] = ()
    limit: int | None = Field(default=None, ge=0)
    offset: int | None = Field(default=None, ge=0)


__all__ = ["SUPPORTED_TIME_GRAINS", "DatasetQuery"]

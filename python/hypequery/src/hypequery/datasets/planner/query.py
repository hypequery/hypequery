"""The semantic query a caller sends.

Unlike a definition, this is request data, so it forbids unknown keys and
carries no SQL, no settings, and no tenant: those are the trusted planner's,
and a field that let a request supply one would be the whole capability
boundary undone.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from ..constants import SUPPORTED_TIME_GRAINS
from ..query_helpers import Filter, Order

TimeGrain = str


class DatasetQuery(BaseModel):
    """A grouped aggregation over one dataset."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    dimensions: tuple[str, ...] = ()
    measures: tuple[str, ...] | None = None
    filters: tuple[Filter, ...] = ()
    by: TimeGrain | None = None
    order_by: tuple[Order, ...] = ()
    limit: int | None = Field(default=None, ge=0)
    offset: int | None = Field(default=None, ge=0)


__all__ = ["SUPPORTED_TIME_GRAINS", "DatasetQuery"]

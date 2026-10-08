"""Strict wire models. Request input never contains execution policy."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, field_validator

from ..datasets.planner import DatasetQuery
from ..datasets.utils.query_timezone import validate_timezone
from .utils.query_input import decode_filters, decode_having, decode_orders


class QueryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=False, allow_inf_nan=False)

    timezone: StrictStr | None = None

    @field_validator("timezone")
    @classmethod
    def _timezone(cls, value: str | None) -> str | None:
        return None if value is None else validate_timezone(value)

    dimensions: list[StrictStr] = Field(default_factory=list, max_length=100)
    measures: list[StrictStr] | None = Field(default=None, max_length=100)
    filters: list[dict[str, object]] = Field(default_factory=list, max_length=100)
    having: list[dict[str, object]] = Field(default_factory=list, max_length=100)
    order_by: list[dict[str, object]] = Field(default_factory=list, alias="orderBy", max_length=100)
    by: StrictStr | None = None
    limit: StrictInt | None = Field(default=None, ge=1)
    offset: StrictInt | None = Field(default=None, ge=0, le=1_000_000)
    include_meta: StrictBool = Field(default=False, alias="includeMeta")

    def semantic(self, limit: int, measures: tuple[str, ...] | None = None) -> DatasetQuery:
        return DatasetQuery(
            timezone=self.timezone,
            dimensions=tuple(self.dimensions),
            measures=measures
            if measures is not None
            else (tuple(self.measures) if self.measures is not None else None),
            filters=decode_filters(self.filters),
            having=decode_having(self.having),
            order_by=decode_orders(self.order_by),
            by=self.by,
            limit=limit,
            offset=self.offset,
        )


class MetricRequest(QueryRequest):
    # A metric fixes its measure server-side. Even an empty override is refused.
    measures: None = None
    # Metric queries do not accept having conditions, matching TypeScript.
    having: None = None  # type: ignore[assignment]


class WireModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class PaginationMeta(WireModel):
    limit: int
    offset: int
    hasMore: bool  # noqa: N815 - language-neutral wire shape


class CacheMeta(WireModel):
    hit: bool


class PublicQueryMeta(WireModel):
    requestId: str  # noqa: N815
    timingMs: float  # noqa: N815
    rowCount: int  # noqa: N815
    pagination: PaginationMeta
    cache: CacheMeta


class QueryResponse(WireModel):
    data: list[dict[str, str | int | float | bool | None]]
    meta: PublicQueryMeta | None = None


class QueryDiagnostics(WireModel):
    # Redacted debug SQL only: parameter values and raw tenant ids stay server-side.
    sql: str


class DiagnosticQueryResponse(QueryResponse):
    diagnostics: QueryDiagnostics

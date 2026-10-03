"""Project client results onto the public HTTP metadata allowlist."""

from __future__ import annotations

from ...datasets import Dataset
from ...datasets.client import DatasetQueryResult, ResultScalar
from ...protocol._jcs import serialize_number
from ..models import CacheMeta, PaginationMeta, PublicQueryMeta, QueryResponse


def _measure_value(value: ResultScalar) -> str | None:
    if value is None:
        return None
    if type(value) is bool:
        return "true" if value else "false"
    return serialize_number(value) if type(value) is float else str(value)


def public_response(
    result: DatasetQueryResult, request_id: str, include_meta: bool, dataset: Dataset
) -> QueryResponse:
    meta = None
    pagination = result.meta.pagination
    if include_meta:
        if pagination is None:
            raise RuntimeError("served queries require pagination metadata")
        meta = PublicQueryMeta(
            requestId=request_id,
            timingMs=result.meta.timing_ms,
            rowCount=result.meta.row_count,
            pagination=PaginationMeta(
                limit=pagination.limit, offset=pagination.offset, hasMore=pagination.has_more
            ),
            cache=CacheMeta(hit=result.meta.cache == "hit"),
        )
    # Every non-null semantic measure is a string on the shared HTTP wire.
    data = [
        {
            name: _measure_value(value) if name in dataset.measures else value
            for name, value in row.items()
        }
        for row in result.data
    ]
    return QueryResponse(data=data, meta=meta)

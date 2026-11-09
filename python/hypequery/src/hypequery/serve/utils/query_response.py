"""Project client results onto the public HTTP metadata allowlist."""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping

from ...datasets.client import DatasetQueryResult, ResultScalar
from ...protocol import serialize_protocol_number
from ..models import CacheMeta, PaginationMeta, PublicQueryMeta, QueryResponse


def _measure_value(value: ResultScalar) -> str | None:
    if value is None:
        return None
    if type(value) is bool:
        return "true" if value else "false"
    return serialize_protocol_number(value) if type(value) is float else str(value)


#: The largest integer a JSON reader that parses numbers as binary64 (JavaScript) keeps exact.
_MAX_SAFE_INTEGER = 2**53 - 1


def _dimension_value(value: ResultScalar) -> ResultScalar:
    # A wider integer (an Int64 or UInt64 id) would round in JavaScript, so it
    # travels as a string, as TypeScript serve sends ClickHouse's 64-bit integers.
    if type(value) is int and not -_MAX_SAFE_INTEGER <= value <= _MAX_SAFE_INTEGER:
        return str(value)
    return value


def public_response(
    result: DatasetQueryResult, request_id: str, include_meta: bool, measures: Collection[str]
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
            cache=(
                None if result.meta.cache == "off" else CacheMeta(hit=result.meta.cache == "hit")
            ),
        )
    return QueryResponse(data=public_rows(result.data, measures), meta=meta)


def public_rows(
    rows: Iterable[Mapping[str, ResultScalar]], measures: Collection[str]
) -> list[dict[str, ResultScalar]]:
    """*rows* as the shared HTTP wire carries them.

    Every non-null measure is a string, and so is a dimension integer beyond
    ±(2**53 - 1), which a JavaScript client would otherwise round.
    """

    return [
        {
            name: _measure_value(value) if name in measures else _dimension_value(value)
            for name, value in row.items()
        }
        for row in rows
    ]

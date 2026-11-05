"""Validate a backend's query result against the plan that requested it."""

from __future__ import annotations

import math
import re
from collections.abc import Sequence

from ...protocol import ClientQueryPlan
from ..errors import McpToolError, result_too_large
from .bounded_json import ResultJsonBudgetError, decode_result_json

_PERIOD = re.compile(r"\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}:\d{2})?")


def _invalid() -> McpToolError:
    return McpToolError(
        "MCP_EXECUTION_FAILED", "Backend returned an invalid client result.", retryable=False
    )


def _record(value: object, allowed: Sequence[str] | None = None) -> dict[str, object]:
    if not isinstance(value, dict) or (
        allowed is not None and any(key not in allowed for key in value)
    ):
        raise _invalid()
    return value


def _integer(value: object, minimum: int = 0) -> bool:
    return type(value) is int and minimum <= value <= 2**53 - 1


def _string(value: object) -> bool:
    """A string that is valid Unicode: JSON escapes can smuggle in lone surrogates."""

    if type(value) is not str:
        return False
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def _number(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value)  # type: ignore[arg-type]


def _check_row(item: object, fields: list[str], plan: ClientQueryPlan) -> None:
    body = plan["body"]
    endpoint = plan["endpoint"]
    dimensions = body["dimensions"]
    if not isinstance(dimensions, list):
        raise _invalid()
    row = _record(item, fields)
    if len(row) != len(fields):
        raise _invalid()
    for field in fields:
        value = row[field]
        if type(value) is float and not math.isfinite(value):
            raise _invalid()
        if (
            field == "period"
            and body.get("by") is not None
            and value is not None
            and (type(value) is not str or _PERIOD.fullmatch(value) is None)
        ):
            raise _invalid()
        dimension = endpoint["dimensions"].get(field) if field in dimensions else None
        if value is None:
            if dimension is not None and dimension["nullable"] is False:
                raise _invalid()
        elif dimension is None or dimension["wireType"] == "string":
            if not _string(value):
                raise _invalid()
        elif dimension["wireType"] == "number-or-string":
            if not (_string(value) or _number(value)):
                raise _invalid()
        elif dimension["wireType"] == "number":
            if not _number(value):
                raise _invalid()
        elif type(value) is not bool:
            raise _invalid()


def _check_meta(meta: object, rows: int, plan: ClientQueryPlan) -> None:
    if not plan["endpoint"]["metadata"]:
        raise _invalid()
    record = _record(meta, ("requestId", "timingMs", "rowCount", "pagination", "cache"))
    request_id = record.get("requestId")
    timing = record.get("timingMs")
    if (
        not _string(request_id)
        or not 0 < len(request_id) <= 1024  # type: ignore[arg-type]
        or not _number(timing)
        or timing < 0  # type: ignore[operator]
        or record.get("rowCount") != rows
        or type(record.get("rowCount")) is not int
    ):
        raise _invalid()
    pagination = _record(record.get("pagination"), ("limit", "offset", "hasMore"))
    limit = pagination.get("limit")
    has_more = pagination.get("hasMore")
    if (
        not _integer(limit, 1)
        or limit > plan["effectiveLimit"]  # type: ignore[operator]
        or pagination.get("offset") != plan["body"].get("offset")
        or type(has_more) is not bool
        or rows > limit  # type: ignore[operator]
        or (has_more and rows != limit)
    ):
        raise _invalid()
    if "cache" in record and type(_record(record["cache"], ("hit",)).get("hit")) is not bool:
        raise _invalid()


def client_http_result(text: str, plan: ClientQueryPlan) -> dict[str, object]:
    """Exactly the requested row fields, typed per the contract, and closed metadata."""

    try:
        parsed = decode_result_json(text)
    except ResultJsonBudgetError:
        raise result_too_large("Backend result exceeds JSON limits.") from None
    except ValueError:
        raise _invalid() from None
    result = _record(parsed, ("data", "meta"))
    data = result.get("data")
    if not isinstance(data, list) or len(data) > plan["effectiveLimit"]:
        raise _invalid()
    dimensions = plan["body"]["dimensions"]
    if not isinstance(dimensions, list):
        raise _invalid()
    fields = [
        *(str(field) for field in dimensions),
        *plan["selectedMeasures"],
        *(["period"] if plan["body"].get("by") is not None else []),
    ]
    for item in data:
        _check_row(item, fields, plan)
    meta = result.get("meta")
    if meta is not None:
        _check_meta(meta, len(data), plan)
    elif plan["body"].get("includeMeta") is True:
        raise _invalid()
    return result

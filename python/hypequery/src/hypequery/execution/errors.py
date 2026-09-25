"""Map driver failures without exposing its SQL, values, or connection details."""

from __future__ import annotations

from hypequery.datasets.planner import CompiledQueryError


def safe_driver_error(exc: Exception, query_id: str) -> CompiledQueryError:
    from clickhouse_connect.driver.exceptions import (
        Error,
        OperationalError,
    )

    if isinstance(exc, Error):
        if exc.name == "AUTHENTICATION_FAILED":
            return CompiledQueryError(
                "unauthenticated", "ClickHouse authentication failed.", query_id=query_id
            )
        if exc.name in ("ACCESS_DENIED", "NOT_ENOUGH_PRIVILEGES"):
            return CompiledQueryError(
                "forbidden", "ClickHouse access was denied.", query_id=query_id
            )
        if exc.name in ("TIMEOUT_EXCEEDED", "QUERY_WAS_CANCELLED"):
            return CompiledQueryError(
                "deadline-exceeded", "The query timed out.", query_id=query_id
            )
        if exc.name in ("TOO_MANY_ROWS", "TOO_MANY_BYTES"):
            return CompiledQueryError(
                "too-large", "The query result is too large.", query_id=query_id
            )
        if isinstance(exc, OperationalError):
            return CompiledQueryError("unavailable", "", query_id=query_id)
    if isinstance(exc, (ConnectionError, TimeoutError, OSError)):
        return CompiledQueryError("unavailable", "", query_id=query_id)
    return CompiledQueryError("internal", "", query_id=query_id)

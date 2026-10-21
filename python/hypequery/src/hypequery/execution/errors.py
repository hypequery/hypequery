"""Map driver failures without exposing its SQL, values, or connection details."""

from __future__ import annotations

from hypequery.datasets.planner import CompiledQueryError

#: ClickHouse reports a bad password or user under several codes: 516
#: AUTHENTICATION_FAILED, 192 UNKNOWN_USER, 193 WRONG_PASSWORD, 194
#: REQUIRED_PASSWORD and 195 IP_ADDRESS_NOT_ALLOWED. All of them mean the
#: configured credentials were refused, which is what a caller needs to know.
_AUTHENTICATION = frozenset(
    (
        "AUTHENTICATION_FAILED",
        "UNKNOWN_USER",
        "WRONG_PASSWORD",
        "REQUIRED_PASSWORD",
        "IP_ADDRESS_NOT_ALLOWED",
    )
)


def safe_driver_error(exc: Exception, query_id: str) -> CompiledQueryError:
    from clickhouse_connect.driver.exceptions import (
        Error,
        OperationalError,
    )

    if isinstance(exc, Error):
        if exc.name in _AUTHENTICATION:
            return CompiledQueryError(
                "unauthenticated", "ClickHouse authentication failed.", query_id=query_id
            )
        if exc.name in ("ACCESS_DENIED", "NOT_ENOUGH_PRIVILEGES"):
            return CompiledQueryError(
                "forbidden", "ClickHouse access was denied.", query_id=query_id
            )
        if exc.name == "UNKNOWN_DATABASE":
            return CompiledQueryError(
                "not-found", "The ClickHouse database does not exist.", query_id=query_id
            )
        if exc.name in ("TIMEOUT_EXCEEDED", "QUERY_WAS_CANCELLED"):
            return CompiledQueryError(
                "deadline-exceeded", "The query timed out.", query_id=query_id
            )
        # ClickHouse 26 reports a result-limit breach as code 396
        # TOO_MANY_ROWS_OR_BYTES; older servers used the two separate names.
        if exc.name in ("TOO_MANY_ROWS", "TOO_MANY_BYTES", "TOO_MANY_ROWS_OR_BYTES"):
            return CompiledQueryError(
                "too-large", "The query result is too large.", query_id=query_id
            )
        if isinstance(exc, OperationalError):
            return CompiledQueryError("unavailable", "", query_id=query_id)
    if isinstance(exc, (ConnectionError, TimeoutError, OSError)):
        return CompiledQueryError("unavailable", "", query_id=query_id)
    return CompiledQueryError("internal", "", query_id=query_id)

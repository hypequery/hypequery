"""Map driver failures without exposing its SQL, values, or connection details."""

from __future__ import annotations

from hypequery.datasets.planner import CompiledQueryError, ExecutorFailureCode

#: RFC 0010: only the authentication layer may say a caller's credentials were
#: rejected or that a caller lacks access. An executor speaks for the server's
#: own connection, so when the database refuses it, that is a server fault and
#: the caller must not be told to sign in again. TypeScript's executor
#: allow-list leaves these out for the same reason.
AUTH_LAYER_CATEGORIES = frozenset(("unauthenticated", "forbidden"))

#: ClickHouse reports a bad password or user under several codes: 516
#: AUTHENTICATION_FAILED, 192 UNKNOWN_USER, 193 WRONG_PASSWORD, 194
#: REQUIRED_PASSWORD, 195 IP_ADDRESS_NOT_ALLOWED and 720 USER_EXPIRED. All of
#: them mean the server's configured credentials were refused.
CREDENTIAL_ERRORS = frozenset(
    (
        "AUTHENTICATION_FAILED",
        "UNKNOWN_USER",
        "WRONG_PASSWORD",
        "REQUIRED_PASSWORD",
        "IP_ADDRESS_NOT_ALLOWED",
        "USER_EXPIRED",
    )
)

#: The server's configured user lacks a grant, which no caller can fix.
#: ClickHouse reports a missing grant as 497 ACCESS_DENIED ("Not enough
#: privileges") and a database it may not use as 291 DATABASE_ACCESS_DENIED.
#: NOT_ENOUGH_PRIVILEGES is not a ClickHouse code name; it stays from the
#: earlier mapping.
PRIVILEGE_ERRORS = frozenset(("ACCESS_DENIED", "DATABASE_ACCESS_DENIED", "NOT_ENOUGH_PRIVILEGES"))


def server_fault(code: ExecutorFailureCode, diagnostic: str, query_id: str) -> CompiledQueryError:
    """An ``unavailable`` error whose reason goes to the server log only.

    The caller gets the fixed server-fault sentence; *diagnostic* is for an
    operator and must not hold values, SQL, or credentials.
    """

    return CompiledQueryError(
        "unavailable", "", query_id=query_id, code=code, diagnostic=diagnostic
    )


def safe_driver_error(exc: Exception, query_id: str) -> CompiledQueryError:
    from clickhouse_connect.driver.exceptions import (
        Error,
        OperationalError,
    )

    if isinstance(exc, Error):
        if exc.name in CREDENTIAL_ERRORS:
            return server_fault(
                "HQ_EXECUTOR_CREDENTIALS_REJECTED",
                f"ClickHouse rejected the server's configured credentials ({exc.name}); "
                "check the connection's username and password.",
                query_id,
            )
        if exc.name in PRIVILEGE_ERRORS:
            return server_fault(
                "HQ_EXECUTOR_ACCESS_DENIED",
                f"ClickHouse denied the server's configured user ({exc.name}); "
                "check the user's grants.",
                query_id,
            )
        if exc.name == "UNKNOWN_DATABASE":
            return server_fault(
                "HQ_EXECUTOR_DATABASE_MISSING",
                "The configured ClickHouse database does not exist (UNKNOWN_DATABASE); "
                "check the connection's database.",
                query_id,
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

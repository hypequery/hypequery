"""The database refusing the server's own connection is a server fault.

RFC 0010 reserves `unauthenticated` and `forbidden` for the authentication
layer: they tell a caller that *its* credentials or access failed. When
ClickHouse rejects the server's configured user, password, grants, database or
readonly profile, telling the caller to sign in again would be wrong and would
name the backend. These pin that every such failure is `unavailable` with a
fixed message, and that the reason reaches only the server log.
"""

from __future__ import annotations

import ast
import logging
from pathlib import Path
from typing import Any, cast

import pytest
from clickhouse_connect.driver.exceptions import (
    DatabaseError,
    Error,
    OperationalError,
    ProgrammingError,
)

from asgi_client import AsgiClient
from hypequery.datasets.planner import CompiledQuery, CompiledQueryError, TypedParameter
from hypequery.execution import ClickHouseExecutor
from hypequery.execution.errors import (
    AUTH_LAYER_CATEGORIES,
    CREDENTIAL_ERRORS,
    PRIVILEGE_ERRORS,
    safe_driver_error,
)
from hypequery.execution.readonly_settings import readonly_setting_error, wire_settings
from hypequery.serve import (
    Call,
    HttpSecurity,
    Principal,
    ServeResponse,
    create_api,
    to_asgi_app,
)

EXECUTION = Path(__file__).resolve().parents[1] / "src" / "hypequery" / "execution"
FIXED_MESSAGE = "The query executor is unavailable."


class FailingClient:
    def __init__(self, failure: Exception) -> None:
        self.failure = failure

    def query(self, *args: object, **kwargs: object) -> object:
        raise self.failure


def _compiled() -> CompiledQuery:
    return CompiledQuery(
        sql="SELECT {p0:String} AS value",
        parameters={"p0": TypedParameter("p0", "String", "secret-value")},
    )


def _driver_error(name: str, cls: type[Error] = ProgrammingError) -> Error:
    error = cls("Code: 516. password=secret-password user=secret-user")
    error.name = name
    return error


# One case per ClickHouse code, written out, so removing a code from the
# mapping fails here instead of silently falling through to `internal`.
@pytest.mark.parametrize(
    ("name", "code"),
    [
        ("AUTHENTICATION_FAILED", "HQ_EXECUTOR_CREDENTIALS_REJECTED"),
        ("UNKNOWN_USER", "HQ_EXECUTOR_CREDENTIALS_REJECTED"),
        ("WRONG_PASSWORD", "HQ_EXECUTOR_CREDENTIALS_REJECTED"),
        ("REQUIRED_PASSWORD", "HQ_EXECUTOR_CREDENTIALS_REJECTED"),
        ("IP_ADDRESS_NOT_ALLOWED", "HQ_EXECUTOR_CREDENTIALS_REJECTED"),
        ("USER_EXPIRED", "HQ_EXECUTOR_CREDENTIALS_REJECTED"),
        ("ACCESS_DENIED", "HQ_EXECUTOR_ACCESS_DENIED"),
        ("DATABASE_ACCESS_DENIED", "HQ_EXECUTOR_ACCESS_DENIED"),
        ("NOT_ENOUGH_PRIVILEGES", "HQ_EXECUTOR_ACCESS_DENIED"),
        ("UNKNOWN_DATABASE", "HQ_EXECUTOR_DATABASE_MISSING"),
    ],
)
def test_a_refusal_of_the_servers_connection_is_unavailable(name: str, code: str) -> None:
    query = _compiled()
    with pytest.raises(CompiledQueryError) as caught:
        ClickHouseExecutor(cast(Any, FailingClient(_driver_error(name)))).execute(query)

    error = caught.value
    assert error.category == "unavailable"
    assert error.message == FIXED_MESSAGE
    assert error.code == code
    assert error.query_id == query.query_id
    assert error.diagnostic is not None
    assert name in error.diagnostic
    assert "secret" not in error.diagnostic
    assert error.failure.to_data() == {
        "category": "unavailable",
        "message": FIXED_MESSAGE,
        "queryId": error.query_id,
    }
    assert "ClickHouse" not in str(error)
    assert error.__notes__ == [error.diagnostic]


def test_every_mapped_code_is_covered() -> None:
    assert {
        "AUTHENTICATION_FAILED",
        "UNKNOWN_USER",
        "WRONG_PASSWORD",
        "REQUIRED_PASSWORD",
        "IP_ADDRESS_NOT_ALLOWED",
        "USER_EXPIRED",
    } == CREDENTIAL_ERRORS
    assert {"ACCESS_DENIED", "DATABASE_ACCESS_DENIED", "NOT_ENOUGH_PRIVILEGES"} == (
        PRIVILEGE_ERRORS
    )


# --- RFC 0010: only the auth layer claims unauthenticated or forbidden -----


_SOME_NAMES = sorted(
    CREDENTIAL_ERRORS
    | PRIVILEGE_ERRORS
    | {
        "UNKNOWN_DATABASE",
        "UNKNOWN_TABLE",
        "READONLY",
        "TIMEOUT_EXCEEDED",
        "QUERY_WAS_CANCELLED",
        "TOO_MANY_ROWS_OR_BYTES",
        "SYNTAX_ERROR",
        "MEMORY_LIMIT_EXCEEDED",
        "",
    }
)


@pytest.mark.parametrize("cls", [Error, DatabaseError, OperationalError, ProgrammingError])
@pytest.mark.parametrize("name", _SOME_NAMES)
def test_no_driver_failure_claims_an_auth_layer_category(cls: type[Error], name: str) -> None:
    assert safe_driver_error(_driver_error(name, cls), "q").category not in AUTH_LAYER_CATEGORIES


@pytest.mark.parametrize(
    "refusal",
    [
        ProgrammingError("Setting readonly is readonly"),
        ProgrammingError("Setting max_threads is unknown or readonly"),
        ProgrammingError(
            "Cannot modify 'max_result_rows' setting in readonly mode.", name="READONLY"
        ),
    ],
)
def test_readonly_guidance_is_a_server_fault(refusal: Exception) -> None:
    error = readonly_setting_error(refusal, "query", "q")
    assert error is not None
    assert error.category == "unavailable"
    assert error.code == "HQ_EXECUTOR_READONLY_MISCONFIGURED"
    assert error.message == FIXED_MESSAGE
    assert error.diagnostic is not None
    assert "readonly" in error.diagnostic


def test_profile_policy_refusal_is_a_server_fault() -> None:
    with pytest.raises(CompiledQueryError) as caught:
        wire_settings(object(), {"readonly": 1}, "profile", "q")
    assert caught.value.category == "unavailable"
    assert caught.value.code == "HQ_EXECUTOR_READONLY_MISCONFIGURED"


def test_the_execution_package_never_names_an_auth_layer_category() -> None:
    """A structural guard: a new mapping cannot quietly claim one.

    The only place these strings may appear is the constant that names them.
    """

    offenders: list[str] = []
    for path in sorted(EXECUTION.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        allowed: set[int] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "AUTH_LAYER_CATEGORIES"
                for target in node.targets
            ):
                allowed.update(id(child) for child in ast.walk(node))
        offenders.extend(
            f"{path.name}:{node.lineno}"
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant)
            and node.value in AUTH_LAYER_CATEGORIES
            and id(node) not in allowed
        )
    assert offenders == []
    assert {"unauthenticated", "forbidden"} == AUTH_LAYER_CATEGORIES


# --- over HTTP --------------------------------------------------------------


def test_a_wrong_server_password_is_a_503_with_the_reason_only_in_the_log(
    caplog: pytest.LogCaptureFixture,
) -> None:
    executor = ClickHouseExecutor(cast(Any, FailingClient(_driver_error("WRONG_PASSWORD"))))

    async def query(call: Call) -> ServeResponse:
        executor.execute(_compiled())
        return ServeResponse.json({"ok": True})

    api = create_api(
        auth=lambda credential: Principal(subject="reader"),
        security=HttpSecurity(allowed_hosts=("testserver",)),
    )
    api.add_route("GET", "/query", query)
    with caplog.at_level(logging.ERROR, logger="hypequery.serve"):
        response = AsgiClient(to_asgi_app(api)).get(
            "/query", headers={"Authorization": "Bearer token", "x-request-id": "req-ch-auth"}
        )

    assert response.status_code == 503
    assert response.json() == {
        "error": {"type": "CLICKHOUSE_UNREACHABLE", "message": FIXED_MESSAGE}
    }
    assert "www-authenticate" not in response.headers
    for leaked in ("ClickHouse", "password", "credential", "WRONG_PASSWORD", "secret"):
        assert leaked not in response.text

    request_id = response.headers["x-request-id"]
    records = [r for r in caplog.records if r.name == "hypequery.serve"]
    assert len(records) == 1
    logged = records[0].getMessage()
    assert f"request_id={request_id}" in logged
    assert "HQ_EXECUTOR_CREDENTIALS_REJECTED" in logged
    assert "WRONG_PASSWORD" in logged
    assert "secret" not in logged

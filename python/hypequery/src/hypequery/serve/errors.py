"""The canonical serve error envelope, shared with `@hypequery/serve`.

Every error a served route returns has the TypeScript shape:

    {"error": {"type": <ServeErrorType>, "message": <str>, "details"?: {...}}}

with `Cache-Control: no-store` and an `x-request-id`. The language-neutral
fixtures in `specs/serve-http/fixtures/errors-v1` pin it for both
implementations. Nothing raised by a driver, a provider, or unexpected code
reaches a body: an unexpected exception is logged here, with its request id,
and answered with a fixed sentence.
"""

from __future__ import annotations

import logging
import secrets
from collections.abc import Mapping
from typing import Literal, TypeAlias

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from starlette.responses import JSONResponse

from ..datasets.planner import CompiledQueryError, CompiledQueryErrorCategory
from .request_ids import request_id

ServeErrorType: TypeAlias = Literal[
    "VALIDATION_ERROR",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "QUERY_FAILURE",
    "CLICKHOUSE_UNREACHABLE",
    "RATE_LIMITED",
    "NOT_FOUND",
    "PAYLOAD_TOO_LARGE",
    "GATEWAY_TIMEOUT",
    "SERVICE_UNAVAILABLE",
    "INTERNAL_SERVER_ERROR",
]

UNEXPECTED_ERROR_MESSAGE = "An unexpected error occurred"

_log = logging.getLogger("hypequery.serve")

#: RFC 0010 categories over HTTP. The message of a server-fault category is
#: already fixed by `CompiledQueryError`; `internal` uses TypeScript's.
_CATEGORIES: Mapping[CompiledQueryErrorCategory, tuple[int, ServeErrorType]] = {
    "input-invalid": (400, "VALIDATION_ERROR"),
    "unauthenticated": (401, "UNAUTHORIZED"),
    "forbidden": (403, "FORBIDDEN"),
    "tenant-required": (403, "FORBIDDEN"),
    "not-found": (404, "NOT_FOUND"),
    "too-large": (413, "PAYLOAD_TOO_LARGE"),
    "aborted": (503, "SERVICE_UNAVAILABLE"),
    "deadline-exceeded": (504, "GATEWAY_TIMEOUT"),
    "unavailable": (503, "CLICKHOUSE_UNREACHABLE"),
    "internal": (500, "INTERNAL_SERVER_ERROR"),
}

#: Every 5xx category answers with a fixed sentence, whatever the error
#: carried: a server-side failure's text is for the log, not the caller.
_SERVER_MESSAGES: Mapping[CompiledQueryErrorCategory, str] = {
    "aborted": "The request was cancelled.",
    "deadline-exceeded": "The query did not finish in time.",
    "unavailable": "The query executor is unavailable.",
    "internal": UNEXPECTED_ERROR_MESSAGE,
}

_STATUS_TYPES: Mapping[int, ServeErrorType] = {
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    413: "PAYLOAD_TOO_LARGE",
    429: "RATE_LIMITED",
    503: "SERVICE_UNAVAILABLE",
    504: "GATEWAY_TIMEOUT",
}

_LOCATIONS = frozenset(("body", "query", "path", "header", "cookie"))


class ServeError(HTTPException):
    """Raise from an endpoint to return a specific canonical error.

    The counterpart of TypeScript's `ServeHttpError`. *message* is sent as
    written, so it must be safe for the caller to read.
    """

    def __init__(
        self,
        status: int,
        type: ServeErrorType,  # noqa: A002 - the envelope's own field name
        message: str,
        *,
        details: Mapping[str, object] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(status, detail=message, headers=dict(headers or {}))
        self.type: ServeErrorType = type
        self.message = message
        self.details = dict(details) if details is not None else None


def _status_type(status: int) -> ServeErrorType:
    if status in _STATUS_TYPES:
        return _STATUS_TYPES[status]
    return "INTERNAL_SERVER_ERROR" if status >= 500 else "VALIDATION_ERROR"


def _issues(error: RequestValidationError) -> list[dict[str, object]]:
    issues: list[dict[str, object]] = []
    for item in error.errors():
        location = list(item.get("loc", ()))
        if location and location[0] in _LOCATIONS:
            location = location[1:]
        # Only the path, a message, and a code: Pydantic's `input` and `ctx`
        # echo submitted values and internal objects.
        issues.append(
            {"path": location, "message": str(item.get("msg", "")), "code": item.get("type")}
        )
    return issues


def as_serve_error(exc: BaseException) -> ServeError:
    """The canonical error for *exc*, logging anything unexpected."""

    if isinstance(exc, ServeError):
        return exc
    if isinstance(exc, RequestValidationError):
        return ServeError(
            400, "VALIDATION_ERROR", "Request validation failed", details={"issues": _issues(exc)}
        )
    if isinstance(exc, CompiledQueryError):
        status, kind = _CATEGORIES[exc.category]
        message = _SERVER_MESSAGES.get(exc.category, exc.message)
        return ServeError(status, kind, message)
    if isinstance(exc, HTTPException):
        kind = _status_type(exc.status_code)
        # An endpoint's own string detail is its intended message, as with
        # TypeScript's ServeHttpError. Anything else is not text to show.
        message = exc.detail if type(exc.detail) is str else UNEXPECTED_ERROR_MESSAGE
        if exc.status_code >= 500 and exc.status_code not in _STATUS_TYPES:
            message = UNEXPECTED_ERROR_MESSAGE
        return ServeError(exc.status_code, kind, message, headers=exc.headers)
    _log.error("Unhandled error in a served route", exc_info=exc)
    return ServeError(500, "INTERNAL_SERVER_ERROR", UNEXPECTED_ERROR_MESSAGE)


def error_response(request: Request, error: ServeError) -> JSONResponse:
    """Render *error* in the canonical envelope."""

    body: dict[str, object] = {"type": error.type, "message": error.message}
    if error.details is not None:
        body["details"] = error.details
    headers = dict(error.headers or {})
    headers["Cache-Control"] = "no-store"
    # The profile's middleware replaces this with the authoritative id when it
    # is installed; without it, an error still carries one.
    headers["x-request-id"] = request_id(request) or secrets.token_hex(16)
    return JSONResponse({"error": body}, status_code=error.status_code, headers=headers)

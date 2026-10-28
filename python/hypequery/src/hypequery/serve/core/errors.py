"""The canonical serve error envelope, shared with `@hypequery/serve`.

Every error the core returns has the TypeScript shape:

    {"error": {"type": <ServeErrorType>, "message": <str>, "details"?: {...}}}

with `cache-control: no-store` and an `x-request-id`. The language-neutral
fixtures in `specs/serve-http/fixtures/errors-v1` pin it for both
implementations. Nothing raised by a driver, a provider, or unexpected code
reaches a body: an unexpected exception is logged here, with its request id,
and answered with a fixed sentence.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from typing import Literal, TypeAlias

from ...datasets.planner import CompiledQueryError, CompiledQueryErrorCategory
from .messages import ServeResponse

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

_LOCATIONS = frozenset(("body", "query", "path", "header", "cookie"))


class ServeError(Exception):
    """Raise from a handler to return a specific canonical error.

    The counterpart of TypeScript's `ServeError`. *message* is sent as
    written, so it must be safe for the caller to read; *headers* are added to
    the error response.
    """

    status_code: int
    type: ServeErrorType
    message: str
    details: dict[str, object] | None
    headers: Mapping[str, str] | None

    def __init__(
        self,
        status: int,
        type: ServeErrorType,  # noqa: A002 - the envelope's own field name
        message: str,
        *,
        details: Mapping[str, object] | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status
        self.type = type
        self.message = message
        self.details = dict(details) if details is not None else None
        self.headers = dict(headers or {})


def serve_error(
    status: int,
    type: ServeErrorType,  # noqa: A002 - the envelope's own field name
    message: str,
    *,
    details: Mapping[str, object] | None = None,
    headers: Mapping[str, str] | None = None,
) -> ServeError:
    """A canonical error to raise. *message* is sent as written."""

    return ServeError(status, type, message, details=details, headers=headers)


def validation_issues(
    errors: Sequence[Mapping[str, object]],
) -> list[dict[str, object]]:
    """Pydantic-style errors as wire issues: path, message and code only.

    Pydantic's `input` and `ctx` echo submitted values and internal objects.
    """

    issues: list[dict[str, object]] = []
    for item in errors:
        loc = item.get("loc", ())
        location = list(loc) if isinstance(loc, (tuple, list)) else []
        if location and location[0] in _LOCATIONS:
            location = location[1:]
        issues.append(
            {"path": location, "message": str(item.get("msg", "")), "code": item.get("type")}
        )
    return issues


def request_validation_error(errors: Sequence[Mapping[str, object]]) -> ServeError:
    """The canonical 400 for input that failed validation."""

    return serve_error(
        400,
        "VALIDATION_ERROR",
        "Request validation failed",
        details={"issues": validation_issues(errors)},
    )


def as_serve_error(exc: BaseException, *, request_id: str | None = None) -> ServeError:
    """The canonical error for *exc*, logging anything unexpected."""

    if isinstance(exc, ServeError):
        return exc
    if isinstance(exc, CompiledQueryError):
        status, kind = _CATEGORIES[exc.category]
        message = _SERVER_MESSAGES.get(exc.category, exc.message)
        return serve_error(status, kind, message)
    _log.error(
        "Unhandled error in a served route (request_id=%s)",
        request_id,
        exc_info=exc,
    )
    return serve_error(500, "INTERNAL_SERVER_ERROR", UNEXPECTED_ERROR_MESSAGE)


def error_response(error: ServeError, request_id: str) -> ServeResponse:
    """Render *error* in the canonical envelope."""

    body: dict[str, object] = {"type": error.type, "message": error.message}
    if error.details is not None:
        body["details"] = error.details
    headers = {name.lower(): value for name, value in (error.headers or {}).items()}
    headers["cache-control"] = "no-store"
    headers["x-request-id"] = request_id
    return ServeResponse.json({"error": body}, status=error.status_code, headers=headers)


def not_found_message(method: str, path: str) -> str:
    """TypeScript's 404 sentence, echoing only a short printable-ASCII path."""

    if len(path) <= 2_048 and all(0x21 <= ord(char) <= 0x7E for char in path):
        return f"No endpoint registered for {method} {path}"
    return "No endpoint registered for this request"

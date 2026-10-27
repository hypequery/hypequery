"""The canonical serve error envelope, shared with `@hypequery/serve`.

Every error a served route returns has the TypeScript shape:

    {"error": {"type": <ServeErrorType>, "message": <str>, "details"?: {...}}}

with `Cache-Control: no-store` and an `x-request-id`. The language-neutral
fixtures in `specs/serve-http/fixtures/errors-v1` pin it for both
implementations. The envelope and the mapping of query errors live in the
framework-neutral core (`core/errors.py`); this module adds FastAPI's own
exceptions to that mapping and renders the result as a Starlette response.
"""

from __future__ import annotations

from collections.abc import Mapping

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response

from .core.errors import (
    UNEXPECTED_ERROR_MESSAGE,
    ServeErrorType,
    ServeHttpError,
    request_validation_error,
    use_error_class,
)
from .core.errors import as_serve_error as core_as_serve_error
from .core.errors import error_response as core_error_response
from .request_ids import ensure_request_id
from .utils.starlette_bridge import starlette_response

__all__ = [
    "UNEXPECTED_ERROR_MESSAGE",
    "ServeError",
    "ServeErrorType",
    "as_serve_error",
    "error_response",
    "map_error",
]

_STATUS_TYPES: Mapping[int, ServeErrorType] = {
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    413: "PAYLOAD_TOO_LARGE",
    429: "RATE_LIMITED",
    503: "SERVICE_UNAVAILABLE",
    504: "GATEWAY_TIMEOUT",
}


class ServeError(ServeHttpError, HTTPException):
    """Raise from an endpoint to return a specific canonical error.

    The counterpart of TypeScript's `ServeHttpError`. *message* is sent as
    written, so it must be safe for the caller to read. It is also a FastAPI
    `HTTPException`, so a plain FastAPI route answers it with its status.
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
        HTTPException.__init__(self, status, detail=message, headers=dict(headers or {}))
        self.type = type
        self.message = message
        self.details = dict(details) if details is not None else None


# Everything the core raises is this class, so it stays an HTTPException.
use_error_class(ServeError)


def _status_type(status: int) -> ServeErrorType:
    if status in _STATUS_TYPES:
        return _STATUS_TYPES[status]
    return "INTERNAL_SERVER_ERROR" if status >= 500 else "VALIDATION_ERROR"


def map_error(exc: BaseException, request_id: str | None) -> ServeHttpError:
    """The canonical error for *exc*, FastAPI's exceptions included."""

    if isinstance(exc, ServeHttpError):
        return exc
    if isinstance(exc, RequestValidationError):
        return request_validation_error(exc.errors())
    # FastAPI's HTTPException subclasses Starlette's, which FastAPI itself
    # raises for a body it cannot parse; both are the route's chosen status.
    if isinstance(exc, StarletteHTTPException):
        kind = _status_type(exc.status_code)
        # An endpoint's own string detail is its intended message, as with
        # TypeScript's ServeHttpError. Anything else is not text to show.
        message = exc.detail if type(exc.detail) is str else UNEXPECTED_ERROR_MESSAGE
        if exc.status_code >= 500 and exc.status_code not in _STATUS_TYPES:
            message = UNEXPECTED_ERROR_MESSAGE
        return ServeError(exc.status_code, kind, message, headers=exc.headers)
    return core_as_serve_error(exc, request_id=request_id)


def as_serve_error(exc: BaseException, *, request: Request | None = None) -> ServeHttpError:
    """The canonical error for *exc*, logging anything unexpected."""

    return map_error(exc, ensure_request_id(request) if request is not None else None)


def error_response(request: Request, error: ServeHttpError) -> Response:
    """Render *error* in the canonical envelope."""

    # The profile's middleware replaces the id with the authoritative one when
    # it is installed; without it, an error still carries one.
    return starlette_response(core_error_response(error, ensure_request_id(request)))

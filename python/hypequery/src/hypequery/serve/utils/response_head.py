"""A `ServeResponse`'s status line and headers, as a server writes them."""

from __future__ import annotations

from collections.abc import Callable
from http import HTTPStatus
from typing import Any, Protocol, TypeVar

from ..core.messages import ServeResponse


class _FrameworkResponse(Protocol):
    @property
    def headers(self) -> Any: ...


_Reply = TypeVar("_Reply", bound=_FrameworkResponse)


def bodiless(status: int) -> bool:
    """Whether HTTP forbids a body for *status*."""

    return status < 200 or status in (204, 304)


def response_headers(response: ServeResponse) -> list[tuple[str, str]]:
    """The response's headers, with a `content-length` for any body it may carry."""

    headers = list(response.headers.items())
    if not bodiless(response.status) and "content-length" not in response.headers:
        headers.append(("content-length", str(len(response.body))))
    return headers


def response_body(response: ServeResponse) -> bytes:
    return b"" if bodiless(response.status) else response.body


def status_line(status: int) -> str:
    """The WSGI status, `"200 OK"`; a code with no standard phrase keeps its number.

    The phrase is the running Python's `HTTPStatus` table, as wsgiref and
    Django write it, so it can differ between versions (3.13 renamed 413 to
    "Content Too Large"). Clients act on the code alone.
    """

    try:
        return f"{status} {HTTPStatus(status).phrase}"
    except ValueError:
        return f"{status} "


def framework_response(response: ServeResponse, build: Callable[[bytes, int], _Reply]) -> _Reply:
    """*response* as a framework's own response object, made by `build(body, status)`.

    Django's `HttpResponse` and Flask's `Response` both add a default
    `Content-Type`; it is removed when the core sent none, so a bodiless or
    plain answer is not mislabelled. The framework sets `Content-Length`.
    """

    reply = build(response_body(response), response.status)
    if "content-type" not in response.headers:
        del reply.headers["Content-Type"]
    for name, value in response.headers.items():
        reply.headers[name] = value
    return reply

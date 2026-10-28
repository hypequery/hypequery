"""A `ServeResponse`'s status line and headers, as a server writes them."""

from __future__ import annotations

from http import HTTPStatus

from ..core.messages import ServeResponse


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

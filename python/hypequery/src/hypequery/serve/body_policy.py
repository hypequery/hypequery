"""Request body policy for FastAPI-served routes: JSON only, and bounded while it streams.

A declared `Content-Length` over the limit is refused before a byte is read.
Without one, the limit and JSON requirement are enforced as the body arrives,
so leaving the header off is not a way around either check.
"""

from __future__ import annotations

from fastapi import Request
from starlette.types import Message

from .core.body import DEFAULT_MAX_BODY_BYTES, check_body_headers, require_json, too_large
from .utils.starlette_bridge import request_headers

__all__ = ["DEFAULT_MAX_BODY_BYTES", "enforce_body_policy"]


def enforce_body_policy(request: Request, max_bytes: int) -> Request:
    """*request* with its body checked and its reads bounded.

    Returns a request over the same scope whose `receive` refuses to deliver
    more than *max_bytes*. The route handler must use it in place of the
    original. Routes served by the core apply the same policy there.
    """

    headers = request_headers(request)
    has_body = check_body_headers(headers, max_bytes)

    upstream = request.receive
    received = 0
    checked_json = has_body

    async def bounded_receive() -> Message:
        nonlocal checked_json, received
        message = await upstream()
        if message["type"] == "http.request":
            body = message.get("body", b"")
            if body and not checked_json:
                # A body need not have Content-Length or Transfer-Encoding.
                require_json(headers)
                checked_json = True
            received += len(body)
            if received > max_bytes:
                raise too_large()
        return message

    return Request(request.scope, bounded_receive)

"""Request body policy for served routes: JSON only, and bounded while it streams.

A declared `Content-Length` over the limit is refused before a byte is read.
Without one, the limit and JSON requirement are enforced as the body arrives,
so leaving the header off is not a way around either check.
"""

from __future__ import annotations

from fastapi import HTTPException, Request
from starlette.types import Message

#: The TypeScript Node adapter's default.
DEFAULT_MAX_BODY_BYTES = 1_048_576

_JSON = "application/json"


def _refuse(status: int, category: str, message: str) -> HTTPException:
    return HTTPException(
        status,
        detail={"category": category, "message": message},
        headers={"Cache-Control": "no-store"},
    )


def _too_large(max_bytes: int) -> HTTPException:
    return _refuse(413, "too-large", f"The request body may not exceed {max_bytes} bytes.")


def _declared_length(request: Request) -> int | None:
    values = request.headers.getlist("content-length")
    if not values:
        return None
    # Two lengths, or one that is not plain ASCII digits, is how request
    # smuggling starts; refuse rather than pick an interpretation.
    if len(values) != 1 or not values[0].isascii() or not values[0].isdigit():
        raise _refuse(400, "input-invalid", "The request has an invalid Content-Length.")
    return int(values[0])


def _require_json(request: Request) -> None:
    media_type, _, parameters = request.headers.get("content-type", "").partition(";")
    if media_type.strip().lower() != _JSON:
        raise _refuse(415, "input-invalid", "Request bodies must be application/json.")
    charset = parameters.strip().lower()
    if charset and charset.replace(" ", "") not in ("charset=utf-8", 'charset="utf-8"'):
        raise _refuse(415, "input-invalid", "Request bodies must be UTF-8 JSON.")


def enforce_body_policy(request: Request, max_bytes: int) -> Request:
    """*request* with its body checked and its reads bounded.

    Returns a request over the same scope whose `receive` refuses to deliver
    more than *max_bytes*. The route handler must use it in place of the
    original.
    """

    declared = _declared_length(request)
    if declared is not None and declared > max_bytes:
        raise _too_large(max_bytes)
    has_body = declared > 0 if declared is not None else "transfer-encoding" in request.headers
    if has_body:
        _require_json(request)

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
                _require_json(request)
                checked_json = True
            received += len(body)
            if received > max_bytes:
                raise _too_large(max_bytes)
        return message

    return Request(request.scope, bounded_receive)

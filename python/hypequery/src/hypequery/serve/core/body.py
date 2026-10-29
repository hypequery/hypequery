"""Request body policy: JSON only, and bounded while it streams.

A declared `Content-Length` over the limit is refused before a byte is read.
Without one, the limit and JSON requirement are enforced as the body arrives,
so leaving the header off is not a way around either check. A body is read
only by a route that takes input, and only after authentication. It must be
UTF-8 JSON as `JSON.parse` reads it, nested no deeper than `MAX_BODY_DEPTH`
(`utils/json_body.py`).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterable

from pydantic import TypeAdapter, ValidationError

from .errors import ServeError, request_validation_error, serve_error
from .messages import Headers, ServeRequest
from .utils.json_body import BodyJsonError, parse_body_json

#: The TypeScript Node adapter's default.
DEFAULT_MAX_BODY_BYTES = 1_048_576

_JSON = "application/json"


def _refuse(status: int, message: str) -> ServeError:
    return serve_error(status, "VALIDATION_ERROR", message)


def too_large() -> ServeError:
    # TypeScript's Node adapter message. The limit is the server's own
    # configuration, so stating it is not a leak, but there is no need to.
    return serve_error(413, "PAYLOAD_TOO_LARGE", "Request body exceeds the configured size limit")


def _declared_length(headers: Headers) -> int | None:
    values = headers.getlist("content-length")
    if not values:
        return None
    # Two lengths, or one that is not plain ASCII digits, is how request
    # smuggling starts; refuse rather than pick an interpretation.
    if len(values) != 1 or not values[0].isascii() or not values[0].isdigit():
        raise _refuse(400, "The request has an invalid Content-Length.")
    return int(values[0])


def _require_identity_encoding(headers: Headers) -> None:
    # The body limit counts bytes as they arrive; a compressed body would be
    # measured before it expands, so none is accepted.
    for value in headers.getlist("content-encoding"):
        if any(coding.strip().lower() not in ("", "identity") for coding in value.split(",")):
            raise _refuse(415, "Request bodies must not be content-encoded.")


def require_json(headers: Headers) -> None:
    media_type, _, parameters = (headers.get("content-type") or "").partition(";")
    if media_type.strip().lower() != _JSON:
        raise _refuse(415, "Request bodies must be application/json.")
    charset = parameters.strip().lower()
    if charset and charset.replace(" ", "") not in ("charset=utf-8", 'charset="utf-8"'):
        raise _refuse(415, "Request bodies must be UTF-8 JSON.")


def check_body_headers(headers: Headers, max_bytes: int) -> bool:
    """Refuse a body the headers already rule out; return whether one is declared.

    When a body is declared, its media type has been checked here; otherwise
    it is checked when the first byte arrives.
    """

    _require_identity_encoding(headers)
    declared = _declared_length(headers)
    if declared is not None and declared > max_bytes:
        raise too_large()
    has_body = declared > 0 if declared is not None else "transfer-encoding" in headers
    if has_body:
        require_json(headers)
    return has_body


async def _chunks(body: bytes | AsyncIterable[bytes]) -> AsyncIterable[bytes]:
    if isinstance(body, bytes):
        yield body
        return
    async for chunk in body:
        yield chunk


async def read_body(request: ServeRequest, max_bytes: int, *, checked_json: bool) -> bytes:
    """The whole body, refused as soon as it passes *max_bytes*.

    A body need not have `Content-Length` or `Transfer-Encoding`, so the media
    type is checked on the first byte when the headers declared none.
    """

    received = bytearray()
    async for chunk in _chunks(request.body):
        if chunk and not checked_json:
            require_json(request.headers)
            checked_json = True
        received.extend(chunk)
        if len(received) > max_bytes:
            raise too_large()
    return bytes(received)


async def _read_or_refuse(request: ServeRequest, max_bytes: int, *, checked_json: bool) -> bytes:
    try:
        return await read_body(request, max_bytes, checked_json=checked_json)
    except ServeError:
        raise
    except Exception as exc:
        # The answer to a body that could not be received (FastAPI's wording).
        raise _refuse(400, "There was an error parsing the body") from exc


async def receive_body(request: ServeRequest, max_bytes: int) -> bytes:
    """The whole body under the body policy, for a host that must buffer it first."""

    checked_json = check_body_headers(request.headers, max_bytes)
    return await _read_or_refuse(request, max_bytes, checked_json=checked_json)


async def read_input(
    request: ServeRequest, schema: TypeAdapter[object], max_bytes: int, *, checked_json: bool
) -> object:
    """The body, decoded as JSON and validated against *schema*.

    Errors keep the issue locations and wording the earlier FastAPI layer used,
    so clients see the same validation errors as before.
    """

    raw = await _read_or_refuse(request, max_bytes, checked_json=checked_json)
    try:
        value = parse_body_json(raw) if raw else None
    except json.JSONDecodeError as exc:
        raise request_validation_error(
            [{"type": "json_invalid", "loc": ("body", exc.pos), "msg": "JSON decode error"}]
        ) from None
    except BodyJsonError as exc:
        # Answered here, as caller input: not a 500 from a validator or driver.
        raise request_validation_error(
            [{"type": "json_invalid", "loc": ("body",), "msg": f"JSON decode error: {exc.reason}"}]
        ) from None
    except Exception as exc:
        raise _refuse(400, "There was an error parsing the body") from exc
    if value is None:
        raise request_validation_error(
            [{"type": "missing", "loc": ("body",), "msg": "Field required"}]
        )
    try:
        return schema.validate_python(value, from_attributes=True)
    except ValidationError as exc:
        raise request_validation_error(
            [
                {**error, "loc": ("body", *error["loc"])}
                for error in exc.errors(include_url=False, include_input=False)
            ]
        ) from None

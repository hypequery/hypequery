"""The canonical serve error envelope, shared with `@hypequery/serve`.

Every error a served route returns has the TypeScript shape:

    {"error": {"type": <ServeErrorType>, "message": <str>, "details"?: {...}}}

with `Cache-Control: no-store` and an `x-request-id`. The language-neutral
fixtures in `specs/serve-http/fixtures/errors-v1` pin it for both
implementations. Raise `ServeError` from a handler to answer with a specific
one; the envelope and the mapping of query errors live in the core
(`core/errors.py`).
"""

from __future__ import annotations

from .core.errors import UNEXPECTED_ERROR_MESSAGE, ServeError, ServeErrorType

__all__ = ["UNEXPECTED_ERROR_MESSAGE", "ServeError", "ServeErrorType"]

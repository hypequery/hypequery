"""The answer to a fault in the core itself, for adapters that must still reply."""

from __future__ import annotations

import logging

from ..core.api import Api
from ..core.errors import UNEXPECTED_ERROR_MESSAGE, error_response, serve_error
from ..core.messages import ServeRequest, ServeResponse
from ..core.request_ids import new_request_id

_log = logging.getLogger("hypequery.serve")


def fault_response() -> ServeResponse:
    """A bare 500 for the exception being handled, which is logged, never sent.

    `Api.serve` answers every route's failure itself; an exception escaping
    it is a fault in the core, answered without a detail.
    """

    request_id = new_request_id()
    _log.exception("Unhandled error serving a request (request_id=%s)", request_id)
    error = serve_error(500, "INTERNAL_SERVER_ERROR", UNEXPECTED_ERROR_MESSAGE)
    return error_response(error, request_id)


async def answer(
    api: Api, request: ServeRequest, *, mounted_at: str | None = None
) -> ServeResponse:
    """`api.handle(request)`, with a fault in the core answered by `fault_response`."""

    try:
        return await api.handle(request, mounted_at=mounted_at)
    except Exception:
        return fault_response()

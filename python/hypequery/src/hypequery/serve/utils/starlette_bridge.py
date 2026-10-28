"""Convert between Starlette requests and responses and the core's own.

Until decision 0023's step 3 replaces it with a pure-ASGI adapter, this is the
FastAPI layer's adapter: its routes build a `ServeRequest`, find the request's
`RequestState`, call the core and convert the `ServeResponse` back.
"""

from __future__ import annotations

from fastapi import Request
from starlette.datastructures import QueryParams as StarletteQueryParams
from starlette.responses import Response

from ..core.messages import Headers, QueryParams, ServeRequest, ServeResponse
from ..core.state import RequestState
from ..request_ids import ensure_request_id
from .production_context import production_profile
from .request_work import request_work
from .scope_slot import ScopeSlot

#: One state per request, shared by every route, dependency and middleware that
#: serves it, under a key only this module holds.
_STATE_SLOT: ScopeSlot[RequestState] = ScopeSlot(RequestState)


def request_state(request: Request) -> RequestState:
    """The core state of *request*, adopting the middleware's id, profile and work."""

    return _STATE_SLOT.setdefault(
        request.scope,
        lambda: RequestState(
            request_id=ensure_request_id(request),
            production=production_profile(request),
            work=request_work(request),
        ),
    )


def request_headers(request: Request) -> Headers:
    return Headers(
        (name.decode("latin-1"), value.decode("latin-1")) for name, value in request.headers.raw
    )


def serve_request(request: Request) -> ServeRequest:
    """*request* as the core sees it. Its body is read only if the core reads it."""

    raw_path = request.scope.get("raw_path")
    client = request.client
    return ServeRequest(
        method=request.method,
        path=raw_path.decode("latin-1") if isinstance(raw_path, bytes) else request.scope["path"],
        query=QueryParams(
            StarletteQueryParams(request.scope.get("query_string", b"")).multi_items()
        ),
        headers=request_headers(request),
        body=request.stream(),
        client=(client.host, client.port) if client is not None else None,
        raw=request,
        is_disconnected=request.is_disconnected,
    )


def starlette_response(response: ServeResponse) -> Response:
    headers = dict(response.headers)
    media_type = headers.pop("content-type", None)
    return Response(
        content=response.body,
        status_code=response.status,
        headers=headers,
        media_type=media_type,
    )

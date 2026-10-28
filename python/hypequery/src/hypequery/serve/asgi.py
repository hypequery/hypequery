"""Serve an `Api` to any ASGI server or framework: `to_asgi_app(api)`.

The adapter is pure ASGI and imports no framework. It turns an `http` scope
into a `ServeRequest`, serves it with `Api.serve` and writes the
`ServeResponse`:

- the body is streamed into the request lazily, and the core reads it, bounded
  by its body policy, only for a route that takes input;
- once the body is no longer needed, `http.disconnect` marks the caller gone,
  and the core cancels the query it was waiting for;
- with a production profile, the write is inside the request's admission slot
  and deadline, so a caller that will not read cannot hold a response past
  either;
- `lifespan` runs the optional *lifespan* context around the server's life;
- a websocket is closed: an API serves no websockets.

Run it with uvicorn (`uvicorn app:app`), or mount it in another application:
Starlette and FastAPI with `app.mount("/analytics", to_asgi_app(api))`,
Litestar, Quart or Django's ASGI handler likewise. A mounted app is served
below the mount's `root_path`. Most frameworks do not forward `lifespan` to a
mounted app, so its host runs any startup and shutdown of its own.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable, MutableMapping
from contextlib import AbstractAsyncContextManager
from typing import Any
from urllib.parse import parse_qsl

from .core.api import Api
from .core.errors import UNEXPECTED_ERROR_MESSAGE, error_response, serve_error
from .core.messages import Headers, QueryParams, ServeRequest, ServeResponse
from .core.request_ids import new_request_id
from .utils.asgi_body import AsgiBody
from .utils.asgi_scope import route_path

__all__ = ["AsgiApp", "to_asgi_app"]

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
#: Entered when the server starts and exited when it stops.
Lifespan = Callable[[], AbstractAsyncContextManager[object]]

_log = logging.getLogger("hypequery.serve")


class AsgiApp:
    """The ASGI application serving one `Api`. Build it with `to_asgi_app`."""

    __slots__ = ("api", "lifespan")

    def __init__(self, api: Api, lifespan: Lifespan | None = None) -> None:
        self.api = api
        self.lifespan = lifespan

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        kind = scope["type"]
        if kind == "http":
            await self._http(scope, receive, send)
        elif kind == "lifespan":
            await self._lifespan(receive, send)
        elif kind == "websocket":
            # Closing before accepting answers the handshake with a 403.
            await send({"type": "websocket.close", "code": 1000})
        else:
            raise ValueError(f"unsupported ASGI scope type {kind!r}")

    async def _http(self, scope: Scope, receive: Receive, send: Send) -> None:
        body = AsgiBody(receive)
        started = False

        async def respond(response: ServeResponse) -> None:
            nonlocal started
            started = True
            await _write(response, send)

        try:
            await self.api.serve(_serve_request(scope, body), respond)
        except Exception:
            if started:
                # The deadline passed while the answer was being written: a
                # second status line would corrupt the connection, so the
                # server must close it.
                raise
            # `serve` answers every route's failure itself; reaching here is
            # a fault in the core, answered without a detail.
            request_id = new_request_id()
            _log.exception("Unhandled error serving a request (request_id=%s)", request_id)
            error = serve_error(500, "INTERNAL_SERVER_ERROR", UNEXPECTED_ERROR_MESSAGE)
            await _write(error_response(error, request_id), send)
        finally:
            await body.close()

    async def _lifespan(self, receive: Receive, send: Send) -> None:
        await receive()  # lifespan.startup
        context = self.lifespan() if self.lifespan is not None else None
        try:
            if context is not None:
                await context.__aenter__()
        except Exception:
            _log.exception("The hypequery application failed to start")
            await send({"type": "lifespan.startup.failed", "message": "Startup failed."})
            return
        await send({"type": "lifespan.startup.complete"})
        await receive()  # lifespan.shutdown
        try:
            if context is not None:
                await context.__aexit__(None, None, None)
        except Exception:
            _log.exception("The hypequery application failed to shut down")
            await send({"type": "lifespan.shutdown.failed", "message": "Shutdown failed."})
            return
        await send({"type": "lifespan.shutdown.complete"})


def to_asgi_app(api: Api, *, lifespan: Lifespan | None = None) -> AsgiApp:
    """The ASGI application serving *api*.

    *lifespan*, a zero-argument factory of an async context manager, is
    entered at server startup and exited at shutdown: the place to close an
    executor the API's clients share. When *api* serves strict client
    endpoints, their contract is checked now, so a misconfiguration fails at
    startup rather than on the first request.
    """

    if not isinstance(api, Api):
        raise TypeError("to_asgi_app requires an Api from create_api")
    if lifespan is not None and not callable(lifespan):
        raise TypeError("lifespan must be a callable returning an async context manager")
    if api.client_endpoints.bindings:
        from .client_contract import export_client_contract

        export_client_contract(api)
    return AsgiApp(api, lifespan)


def _serve_request(scope: Scope, body: AsgiBody) -> ServeRequest:
    client = scope.get("client")
    query = scope.get("query_string", b"")
    return ServeRequest(
        method=scope["method"],
        path=route_path(scope),
        query=QueryParams(parse_qsl(query.decode("latin-1"), keep_blank_values=True)),
        headers=Headers(
            (name.decode("latin-1"), value.decode("latin-1")) for name, value in scope["headers"]
        ),
        body=body.chunks(),
        client=(str(client[0]), int(client[1])) if client else None,
        raw=scope,
        is_disconnected=body.is_disconnected,
    )


async def _write(response: ServeResponse, send: Send) -> None:
    headers = [
        (name.encode("latin-1"), value.encode("latin-1"))
        for name, value in response.headers.items()
    ]
    bodiless = response.status < 200 or response.status in (204, 304)
    if not bodiless and "content-length" not in response.headers:
        headers.append((b"content-length", str(len(response.body)).encode("latin-1")))
    await send({"type": "http.response.start", "status": response.status, "headers": headers})
    await send({"type": "http.response.body", "body": b"" if bodiless else response.body})

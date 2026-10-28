"""Serve an `Api` to any WSGI server or framework: `to_wsgi_app(api)`.

The core is async; a WSGI server calls its application on threads without an
event loop. The adapter runs every request's coroutine on one event loop per
process, started on a thread of its own at the first request, while the
server's thread waits (`utils/serving_loop.py`). No loop is created per
request, and what the core keeps between requests (admission slots, rate-limit
windows, a loop-bound async client) lives on that one loop. It is safe under a
threaded server (gunicorn's ``gthread`` workers, waitress): requests from many
threads run concurrently on the loop.

- The body is read from ``wsgi.input`` lazily, by the waiting thread, only for
  a route that takes input and only after authentication, and no further than
  the body policy allows: ``CONTENT_LENGTH`` bytes, or to the end of a chunked
  body the server frames itself (``wsgi.input_terminated``). A server that
  receives whole bodies before calling the application (waitress) needs its
  own size limit as well.
- Headers come from ``HTTP_*``, ``CONTENT_TYPE`` and ``CONTENT_LENGTH``; the
  peer from ``REMOTE_ADDR``. The path is matched as sent when the server passes
  the request target (``RAW_URI`` or ``REQUEST_URI``), else as ``PATH_INFO``.
- WSGI never reports a caller who has gone, so a query is cancelled only by
  its own deadline (a `ProductionProfile`'s timeout), or when the server
  interrupts the waiting thread. The server writes the response after the
  admission slot is released, under its own timeouts.
- Nor can a read of ``wsgi.input`` be interrupted without corrupting the
  connection. When the deadline passes during a stalled upload, the core
  answers 504 and asks for nothing more, but the read already in flight (at
  most 64 KiB) returns only when its bytes arrive or the server's socket gives
  up. As for any WSGI application, put a proxy that buffers request bodies in
  front (nginx does by default), or use a server that receives the whole body
  before calling the application (waitress).

Run it with gunicorn (``gunicorn app:app --threads 8``) or waitress, or mount
it in a WSGI framework, below a prefix (Werkzeug's ``DispatcherMiddleware``):
the path is matched below ``SCRIPT_NAME``. Client contracts name paths under
the API's ``client_mount_path``, never under a prefix a server or proxy sets.
The loop stops at interpreter exit; each worker a preloading server forks
starts its own.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import Any

from .core.api import Api
from .core.messages import ServeRequest
from .utils.blocking import serve_blocking
from .utils.response_head import response_body, response_headers, status_line
from .utils.serving_loop import RequestThread
from .utils.thread_body import thread_body
from .utils.wsgi_environ import (
    body_length,
    decoded_path,
    environ_client,
    environ_headers,
    environ_query,
    path_below,
    request_target_path,
)

__all__ = ["WsgiApp", "to_wsgi_app"]

Environ = Mapping[str, Any]
StartResponse = Callable[..., Any]


class WsgiApp:
    """The WSGI application serving one `Api`. Build it with `to_wsgi_app`."""

    __slots__ = ("api",)

    def __init__(self, api: Api) -> None:
        self.api = api

    def __call__(self, environ: Environ, start_response: StartResponse) -> Iterable[bytes]:
        def build(thread: RequestThread) -> ServeRequest:
            return ServeRequest(
                method=environ["REQUEST_METHOD"],
                path=_route_path(environ),
                query=environ_query(environ),
                headers=environ_headers(environ),
                body=thread_body(thread, environ["wsgi.input"].read, body_length(environ)),
                client=environ_client(environ),
                raw=environ,
            )

        response = serve_blocking(self.api, build)
        start_response(status_line(response.status), response_headers(response))
        return [response_body(response)]


def to_wsgi_app(api: Api) -> WsgiApp:
    """The WSGI application serving *api*.

    When *api* serves strict client endpoints, their contract is checked now,
    so a misconfiguration fails at startup rather than on the first request.
    """

    if not isinstance(api, Api):
        raise TypeError("to_wsgi_app requires an Api from create_api")
    if api.client_endpoints.bindings:
        from .client_contract import export_client_contract

        export_client_contract(api)
    return WsgiApp(api)


def _route_path(environ: Environ) -> str:
    """The path below ``SCRIPT_NAME``, percent-encoding intact when the server says."""

    raw = request_target_path(environ)
    if raw is not None:
        below = path_below(raw, decoded_path(environ, "SCRIPT_NAME"))
        if below is not None:
            return below
    return decoded_path(environ) or "/"

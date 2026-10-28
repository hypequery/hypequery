"""The HTTP security profile applied around a served application.

`HttpSecurity` is a validated configuration object. A configuration that could
not be safe, such as credentialed CORS for any origin, fails when it is built,
not on the first request. `install_http_security` adds, outermost first:

1. request identifiers: a server-generated `x-request-id` on every response,
   and a caller's own id echoed only as `x-correlation-id`, after validation;
2. proxy trust: forwarded client address and scheme are honoured only from
   addresses listed as trusted proxies;
3. trusted hosts: a request for any other `Host` is refused;
4. CORS: off unless configured.

Each policy is the core's (`core/security.py`, `core/request_ids.py`), the
same code `Api.handle` runs; the middleware here apply it to every route of
the application, the ones the core does not serve included.
"""

from __future__ import annotations

import inspect

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import PlainTextResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .core.errors import not_found_message
from .core.messages import Headers
from .core.request_ids import correlation_id, new_request_id
from .core.security import (
    INVALID_HOST,
    Cors,
    CorsPolicy,
    HttpSecurity,
    ProxyTrust,
    host_allowed,
    raw_host_valid,
)
from .errors import ServeError, error_response
from .request_ids import REQUEST_ID_SLOT
from .utils.starlette_bridge import starlette_response

__all__ = ["CorsPolicy", "HttpSecurity", "install_http_security"]


def _scope_headers(scope: Scope) -> Headers:
    return Headers(
        (name.decode("latin-1"), value.decode("latin-1")) for name, value in scope["headers"]
    )


class _RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        authoritative = new_request_id()
        REQUEST_ID_SLOT.set(scope, authoritative)
        correlation = correlation_id(_scope_headers(scope))

        async def send_with_ids(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                # Whatever a handler set is replaced: the server's id is the
                # only one a client or a log should ever correlate on.
                headers["x-request-id"] = authoritative
                if "x-correlation-id" in headers:
                    del headers["x-correlation-id"]
                if correlation is not None:
                    headers["x-correlation-id"] = correlation
            await send(message)

        await self.app(scope, receive, send_with_ids)


class _ProxyTrustMiddleware:
    """Honour `X-Forwarded-For`/`-Proto` only from a trusted proxy (`core.security.ProxyTrust`)."""

    def __init__(self, app: ASGIApp, trusted: tuple[str, ...]) -> None:
        self.app = app
        self.proxies = ProxyTrust(trusted)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        client = scope.get("client")
        if scope["type"] == "http" and client:
            peer = (client[0], client[1])
            resolved, scheme = self.proxies.resolve(peer, _scope_headers(scope))
            if resolved != peer:
                scope = {**scope, "client": resolved}
            if scheme is not None:
                scope = {**scope, "scheme": scheme}
        await self.app(scope, receive, send)


class _TrustedHostMiddleware:
    """Refuse a malformed raw `Host`, then any host not allowed.

    A websocket has only its host checked against the allowed hosts, as
    Starlette's `TrustedHostMiddleware` checked it.
    """

    def __init__(self, app: ASGIApp, allowed_hosts: tuple[str, ...]) -> None:
        self.app = app
        self.allowed_hosts = allowed_hosts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] in ("http", "websocket"):
            headers = _scope_headers(scope)
            valid = scope["type"] != "http" or raw_host_valid(headers)
            if not (valid and host_allowed(headers, self.allowed_hosts)):
                await PlainTextResponse(INVALID_HOST, status_code=400)(scope, receive, send)
                return
        await self.app(scope, receive, send)


class _CorsMiddleware:
    """Answer preflights and add CORS headers to responses (`core.security.Cors`)."""

    def __init__(self, app: ASGIApp, policy: CorsPolicy) -> None:
        self.app = app
        self.cors = Cors(policy)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = _scope_headers(scope)
        origin = headers.get("origin")
        if origin is None:
            await self.app(scope, receive, send)
            return
        if self.cors.is_preflight(scope["method"], headers):
            await starlette_response(self.cors.preflight(headers))(scope, receive, send)
            return

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start":
                message.setdefault("headers", [])
                response_headers = MutableHeaders(scope=message)
                updates = self.cors.response_headers(origin, response_headers.get("vary"))
                for name, value in updates.items():
                    response_headers[name] = value
            await send(message)

        await self.app(scope, receive, send_with_cors)


def install_http_security(app: FastAPI, security: HttpSecurity) -> None:
    """Add *security*'s middleware to *app*.

    Call it once, before the application starts serving.
    """

    if type(security) is not HttpSecurity:
        raise TypeError("install_http_security requires an HttpSecurity")
    # Starlette wraps each added middleware around the previous ones, so they
    # are added innermost first.
    if security.cors is not None:
        app.add_middleware(_CorsMiddleware, policy=security.cors)
    app.add_middleware(_TrustedHostMiddleware, allowed_hosts=security.allowed_hosts)
    if security.trusted_proxies:
        app.add_middleware(_ProxyTrustMiddleware, trusted=security.trusted_proxies)
    app.add_middleware(_RequestIdMiddleware)
    _install_routing_errors(app)


def _not_found_message(request: Request) -> str:
    # The path as the client sent it, percent-encoding intact, like the
    # TypeScript router's URL pathname.
    raw = request.scope.get("raw_path")
    path = raw.decode("latin-1") if isinstance(raw, bytes) else request.url.path
    return not_found_message(request.method, path)


def _install_routing_errors(app: FastAPI) -> None:
    """Answer requests no route serves the way TypeScript serve does.

    An unmatched path and a matched path with another method are both `404
    NOT_FOUND`: TypeScript matches on method and path together, and a 405
    would list the route's methods to an unauthenticated caller. Any other
    HTTP error goes to the handler the application already had.
    """

    previous = app.exception_handlers.get(StarletteHTTPException, http_exception_handler)

    async def routing_errors(request: Request, exc: Exception) -> Response:
        status = exc.status_code if isinstance(exc, StarletteHTTPException) else 500
        unrouted = status == 404 and "endpoint" not in request.scope
        # Starlette puts its first partial path match in the scope for a 405.
        # Only a ServeRouter route uses method+path matching as a 404 policy.
        from .router import _AuthenticatingRoute

        serve_method_mismatch = status == 405 and isinstance(
            request.scope.get("route"), _AuthenticatingRoute
        )
        if serve_method_mismatch or unrouted:
            error = ServeError(404, "NOT_FOUND", _not_found_message(request))
            return error_response(request, error)
        response = previous(request, exc)
        return await response if inspect.isawaitable(response) else response

    app.add_exception_handler(StarletteHTTPException, routing_errors)

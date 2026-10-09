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
"""

from __future__ import annotations

import inspect
import ipaddress
import re
import secrets
from dataclasses import dataclass

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.responses import PlainTextResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .errors import ServeError, error_response
from .request_ids import REQUEST_ID_SLOT, validate_correlation_id

_ORIGIN = re.compile(r"https?://[a-z0-9.-]+(:[0-9]{1,5})?|https?://\[[0-9a-f:.]+\](:[0-9]{1,5})?")
_HOST = re.compile(r"(\*\.)?[a-z0-9.-]+|\[[0-9a-f:.]+\]")
_REQUEST_HOST = re.compile(rb"(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::([0-9]{1,5}))?")


def _validate_hosts(hosts: object) -> tuple[str, ...]:
    if type(hosts) is not tuple or not hosts:
        raise ValueError("allowed_hosts must be a non-empty tuple of host names")
    for host in hosts:
        if type(host) is not str or host == "*" or not _HOST.fullmatch(host):
            raise ValueError(
                f"allowed host {host!r} is not a lowercase host name, "
                "'*.domain' pattern, or bracketed IPv6 address; '*' is not accepted"
            )
    return hosts


@dataclass(frozen=True, slots=True)
class CorsPolicy:
    """Cross-origin access. Omit it and no CORS headers are ever sent."""

    origins: tuple[str, ...]
    allow_credentials: bool = False
    allow_methods: tuple[str, ...] = ("GET", "POST")
    allow_headers: tuple[str, ...] = ("Authorization", "Content-Type", "X-Request-ID")
    max_age: int = 600

    def __post_init__(self) -> None:
        if type(self.origins) is not tuple or not self.origins:
            raise ValueError("CORS origins must be a non-empty tuple")
        wildcard = self.origins == ("*",)
        if wildcard and self.allow_credentials:
            # A browser sends cookies and credentials cross-origin only to an
            # origin the server named. "Any origin, with credentials" is the
            # configuration that lets every site on the internet act as the user.
            raise ValueError("credentialed CORS requires an explicit origin allowlist, not '*'")
        if not wildcard:
            for origin in self.origins:
                if type(origin) is not str or not _ORIGIN.fullmatch(origin):
                    raise ValueError(
                        f"CORS origin {origin!r} must be exactly scheme://host[:port], "
                        "lowercase, with no path"
                    )
        for label, values in (("methods", self.allow_methods), ("headers", self.allow_headers)):
            if type(values) is not tuple or "*" in values:
                raise ValueError(f"CORS allow_{label} must be an explicit tuple, not '*'")
        if type(self.max_age) is not int or not 0 <= self.max_age <= 86_400:
            raise ValueError("CORS max_age must be between 0 and 86400 seconds")


@dataclass(frozen=True, slots=True)
class HttpSecurity:
    """The HTTP profile for a served application.

    *allowed_hosts* is required: a server that answers for any `Host` header
    can be reached through DNS rebinding and used in cache-poisoning attacks.
    *trusted_proxies* lists the addresses and networks whose forwarded headers
    are believed; the default trusts none.
    """

    allowed_hosts: tuple[str, ...]
    cors: CorsPolicy | None = None
    trusted_proxies: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        _validate_hosts(self.allowed_hosts)
        if self.cors is not None and type(self.cors) is not CorsPolicy:
            raise TypeError("cors must be a CorsPolicy or None")
        if type(self.trusted_proxies) is not tuple:
            raise ValueError("trusted_proxies must be a tuple of addresses or networks")
        for proxy in self.trusted_proxies:
            try:
                ipaddress.ip_network(proxy, strict=False)
            except (TypeError, ValueError) as exc:
                raise ValueError(f"trusted proxy {proxy!r} is not an address or network") from exc


class _RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        authoritative = secrets.token_hex(16)
        REQUEST_ID_SLOT.set(scope, authoritative)
        values = [
            value.decode("latin-1")
            for name, value in scope["headers"]
            if name.lower() == b"x-request-id"
        ]
        correlation = validate_correlation_id(values[0]) if len(values) == 1 else None

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


def _is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


class _ProxyTrustMiddleware:
    """Honour `X-Forwarded-For`/`-Proto` only from a trusted proxy.

    The client address is the rightmost forwarded address that is not itself
    a trusted proxy: everything to its left was written by a party that
    address controls, so it proves nothing.
    """

    def __init__(self, app: ASGIApp, trusted: tuple[str, ...]) -> None:
        self.app = app
        self.networks = tuple(ipaddress.ip_network(item, strict=False) for item in trusted)

    def _trusted(self, address: str) -> bool:
        try:
            parsed = ipaddress.ip_address(address)
        except ValueError:
            return False
        return any(parsed in network for network in self.networks)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        client = scope.get("client")
        if scope["type"] == "http" and client and self._trusted(client[0]):
            forwarded: list[str] = []
            protos: list[str] = []
            for name, value in scope["headers"]:
                if name.lower() == b"x-forwarded-for":
                    # Repeated headers are one list, in the order received.
                    forwarded.extend(part.strip() for part in value.decode("latin-1").split(","))
                elif name.lower() == b"x-forwarded-proto":
                    protos.append(value.decode("latin-1").strip().lower())
            for address in reversed([part for part in forwarded if part]):
                if not self._trusted(address):
                    # A proxy that writes "unknown" or a host:port pair has
                    # not given an address; keep the peer rather than let a
                    # non-address become the client.
                    if _is_ip(address):
                        scope = {**scope, "client": (address, 0)}
                    break
            if len(protos) == 1 and protos[0] in ("http", "https"):
                scope = {**scope, "scheme": protos[0]}
        await self.app(scope, receive, send)


class _RequestHostMiddleware:
    """Reject malformed raw Host headers before Starlette splits off a port."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            hosts = [value for name, value in scope["headers"] if name.lower() == b"host"]
            match = _REQUEST_HOST.fullmatch(hosts[0]) if len(hosts) == 1 else None
            if match is None or (match[1] is not None and int(match[1]) > 65535):
                response = PlainTextResponse("Invalid host header", status_code=400)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


def install_http_security(app: FastAPI, security: HttpSecurity) -> None:
    """Add *security*'s middleware to *app*.

    Call it once, before the application starts serving.
    """

    if type(security) is not HttpSecurity:
        raise TypeError("install_http_security requires an HttpSecurity")
    # Starlette wraps each added middleware around the previous ones, so they
    # are added innermost first.
    cors = security.cors
    if cors is not None:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(cors.origins),
            allow_credentials=cors.allow_credentials,
            allow_methods=list(cors.allow_methods),
            allow_headers=list(cors.allow_headers),
            expose_headers=["x-request-id", "x-correlation-id"],
            max_age=cors.max_age,
        )
    app.add_middleware(
        TrustedHostMiddleware, allowed_hosts=list(security.allowed_hosts), www_redirect=False
    )
    app.add_middleware(_RequestHostMiddleware)
    if security.trusted_proxies:
        app.add_middleware(_ProxyTrustMiddleware, trusted=security.trusted_proxies)
    app.add_middleware(_RequestIdMiddleware)
    _install_routing_errors(app)


def _not_found_message(request: Request) -> str:
    # The path as the client sent it, percent-encoding intact, like the
    # TypeScript router's URL pathname. Anything that is not short printable
    # ASCII is not echoed.
    raw = request.scope.get("raw_path")
    path = raw.decode("latin-1") if isinstance(raw, bytes) else request.url.path
    if len(path) <= 2_048 and all(0x21 <= ord(char) <= 0x7E for char in path):
        return f"No endpoint registered for {request.method} {path}"
    return "No endpoint registered for this request"


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

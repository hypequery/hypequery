"""The HTTP security profile over `ServeRequest`/`ServeResponse`, with no framework.

`HttpSecurity` and `CorsPolicy` are validated configuration: a configuration
that could not be safe, such as credentialed CORS for any origin, fails when it
is built, not on the first request. The policies here are what every adapter
applies, outermost first:

1. proxy trust: forwarded client address and scheme are honoured only from
   addresses listed as trusted proxies;
2. the raw `Host` header: exactly one, well formed, port at most 65535;
3. trusted hosts: a request for any other `Host` is refused;
4. CORS: off unless configured; a preflight is answered here, and an allowed
   origin's response carries the CORS headers.

Request identifiers wrap all of them (`request_ids.py`). CORS answers as
Starlette's `CORSMiddleware` (1.10) does, which tests use as an independent
reference; hosts compare normalised (`utils/host_header.py`).
"""

from __future__ import annotations

import ipaddress
import re
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass

from .messages import Headers, ServeResponse
from .utils.host_header import normalise_host, request_host

_ORIGIN = re.compile(r"https?://[a-z0-9.-]+(:[0-9]{1,5})?|https?://\[[0-9a-f:.]+\](:[0-9]{1,5})?")
_HOST = re.compile(r"(\*\.)?[a-z0-9.-]+|\[[0-9a-f:.]+\]")

#: Every CORS-enabled response exposes the request identifiers to the browser.
EXPOSED_HEADERS = ("x-request-id", "x-correlation-id")
#: Request headers a browser always may send; preflights list them too.
_SAFELISTED_HEADERS = frozenset(("Accept", "Accept-Language", "Content-Language", "Content-Type"))

INVALID_HOST = "Invalid host header"

#: What a preflight answer depends on, so caches keep one answer per request.
_PREFLIGHT_VARY = (
    "Origin, Access-Control-Request-Method, Access-Control-Request-Headers, "
    "Access-Control-Request-Private-Network"
)


def _validate_hosts(hosts: object) -> tuple[str, ...]:
    if type(hosts) is not tuple or not hosts:
        raise ValueError("allowed_hosts must be a non-empty tuple of host names")
    for host in hosts:
        if (
            type(host) is not str
            or host == "*"
            or not _HOST.fullmatch(host)
            or normalise_host(host.removeprefix("*.")) is None
        ):
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
    allow_headers: tuple[str, ...] = (
        "Authorization",
        "Content-Type",
        "X-Request-ID",
        "X-Include-Meta",
        "X-Hypequery-Client-Schema",
    )
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


def plain_text(text: str, status: int, headers: Mapping[str, str] | None = None) -> ServeResponse:
    """A `text/plain` answer with its length and a UTF-8 media type."""

    body = text.encode("utf-8")
    merged = {name.lower(): value for name, value in (headers or {}).items()}
    merged.setdefault("content-length", str(len(body)))
    merged.setdefault("content-type", "text/plain; charset=utf-8")
    return ServeResponse(status=status, headers=merged, body=body)


def raw_host_valid(headers: Headers) -> bool:
    """Exactly one `Host` header, well formed, with a port no higher than 65535."""

    hosts = headers.getlist("host")
    return len(hosts) == 1 and request_host(hosts[0]) is not None


def host_allowed(headers: Headers, allowed_hosts: tuple[str, ...]) -> bool:
    """Whether the request's `Host`, without its port, is one of *allowed_hosts*.

    Hosts compare normalised (`utils/host_header.py`): names case-insensitively
    and without a trailing dot, IPv6 literals in compressed form, so
    `[0:0::1]:8000` is allowed by `[::1]`. `*.example.com` allows any name
    ending `.example.com`, but not `example.com` itself. There is no `www.`
    redirect: a host not listed is refused.
    """

    host = request_host(headers.get("host") or "")
    if host is None:
        return False
    for pattern in allowed_hosts:
        if pattern.startswith("*."):
            # Normalised like the request host, so `*.example.com.` still
            # matches `api.example.com.`. Validation guarantees a domain here.
            if host.endswith("." + (normalise_host(pattern[2:]) or "")):
                return True
        elif host == normalise_host(pattern):
            return True
    return False


def _is_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


class ProxyTrust:
    """Honour `X-Forwarded-For`/`-Proto` only from a trusted proxy.

    The client address is the rightmost forwarded address that is not itself a
    trusted proxy: everything to its left was written by a party that address
    controls, so it proves nothing.
    """

    __slots__ = ("networks",)

    def __init__(self, trusted: tuple[str, ...]) -> None:
        self.networks = tuple(ipaddress.ip_network(item, strict=False) for item in trusted)

    def trusted(self, address: str) -> bool:
        try:
            parsed = ipaddress.ip_address(address)
        except ValueError:
            return False
        return any(parsed in network for network in self.networks)

    def resolve(
        self, client: tuple[str, int] | None, headers: Headers
    ) -> tuple[tuple[str, int] | None, str | None]:
        """The effective client address and scheme; None keeps the scheme as received."""

        if client is None or not self.trusted(client[0]):
            return client, None
        forwarded: list[str] = []
        for value in headers.getlist("x-forwarded-for"):
            # Repeated headers are one list, in the order received.
            forwarded.extend(part.strip() for part in value.split(","))
        protos = [value.strip().lower() for value in headers.getlist("x-forwarded-proto")]
        for address in reversed([part for part in forwarded if part]):
            if not self.trusted(address):
                # A proxy that writes "unknown" or a host:port pair has not
                # given an address; keep the peer rather than let a
                # non-address become the client.
                if _is_ip(address):
                    client = (address, 0)
                break
        scheme = protos[0] if len(protos) == 1 and protos[0] in ("http", "https") else None
        return client, scheme


class Cors:
    """A `CorsPolicy` applied to requests and responses.

    Behaves as Starlette's `CORSMiddleware` (1.10) with explicit methods and
    headers, the request identifiers exposed, and no origin regex or
    private-network access: a preflight is answered `200 OK` or `400 Disallowed
    CORS ...`, and a response to an allowed origin names that origin.

    Every answer varies on what decided it, whether or not the request carried
    an `Origin`, so a shared cache never serves one origin's answer to another
    or a same-origin answer to a cross-origin request.
    """

    __slots__ = (
        "_allow_all_origins",
        "_allow_credentials",
        "_allow_headers",
        "_allow_methods",
        "_origins",
        "_preflight_explicit_origin",
        "_preflight_headers",
        "_simple_headers",
    )

    def __init__(self, policy: CorsPolicy) -> None:
        self._origins = policy.origins
        self._allow_methods = policy.allow_methods
        self._allow_all_origins = "*" in policy.origins
        self._allow_credentials = policy.allow_credentials
        self._preflight_explicit_origin = not self._allow_all_origins or policy.allow_credentials

        simple: dict[str, str] = {}
        if self._allow_all_origins:
            simple["Access-Control-Allow-Origin"] = "*"
        if policy.allow_credentials:
            simple["Access-Control-Allow-Credentials"] = "true"
        simple["Access-Control-Expose-Headers"] = ", ".join(EXPOSED_HEADERS)
        self._simple_headers = simple

        preflight: dict[str, str] = {"Vary": _PREFLIGHT_VARY}
        if not self._preflight_explicit_origin:
            # Otherwise the origin itself is added per preflight, when allowed.
            preflight["Access-Control-Allow-Origin"] = "*"
        preflight["Access-Control-Allow-Methods"] = ", ".join(policy.allow_methods)
        preflight["Access-Control-Max-Age"] = str(policy.max_age)
        allow_headers = sorted(_SAFELISTED_HEADERS | set(policy.allow_headers))
        preflight["Access-Control-Allow-Headers"] = ", ".join(allow_headers)
        if policy.allow_credentials:
            preflight["Access-Control-Allow-Credentials"] = "true"
        self._preflight_headers = preflight
        self._allow_headers = frozenset(header.lower() for header in allow_headers)

    def _allowed_origin(self, origin: str) -> bool:
        return self._allow_all_origins or origin in self._origins

    @staticmethod
    def is_preflight(method: str, headers: Headers) -> bool:
        return (
            "origin" in headers
            and method == "OPTIONS"
            and "access-control-request-method" in headers
        )

    def preflight(self, headers: Headers) -> ServeResponse:
        """The answer to a preflight: `200 OK`, or `400` naming what was refused."""

        origin = headers.get("origin") or ""
        method = headers.get("access-control-request-method") or ""
        requested_headers = headers.get("access-control-request-headers")
        answer = dict(self._preflight_headers)
        failures: list[str] = []
        if self._allowed_origin(origin):
            if self._preflight_explicit_origin:
                answer["Access-Control-Allow-Origin"] = origin
        else:
            failures.append("origin")
        if method not in self._allow_methods:
            failures.append("method")
        if requested_headers is not None:
            for header in (part.lower() for part in requested_headers.split(",")):
                if header.strip() not in self._allow_headers:
                    failures.append("headers")
                    break
        if headers.get("access-control-request-private-network") is not None:
            failures.append("private-network")
        if failures:
            return plain_text("Disallowed CORS " + ", ".join(failures), 400, answer)
        return plain_text("OK", 200, answer)

    def response_headers(self, origin: str | None, existing_vary: str | None) -> dict[str, str]:
        """The headers a response to a request from *origin* gains, lowercase names.

        Set in this order on top of the response's own. A request without an
        `Origin` gains only `Vary: Origin`; *existing_vary* is kept before it.
        """

        updates: dict[str, str] = {}
        if origin is not None:
            updates.update((name.lower(), value) for name, value in self._simple_headers.items())
            explicit = (self._allow_all_origins and self._allow_credentials) or (
                not self._allow_all_origins and self._allowed_origin(origin)
            )
            if explicit:
                updates["access-control-allow-origin"] = origin
        updates["vary"] = f"{existing_vary}, Origin" if existing_vary else "Origin"
        return updates

    def apply(self, response: ServeResponse, headers: Headers) -> ServeResponse:
        """*response* to a request carrying *headers*, with this policy's headers."""

        updates = self.response_headers(headers.get("origin"), response.headers.get("vary"))
        return response.with_headers(updates)

    def around(
        self, headers: Headers, respond: Callable[[ServeResponse], Awaitable[None]]
    ) -> Callable[[ServeResponse], Awaitable[None]]:
        """*respond*, applying this policy to each answer to a request with *headers*."""

        async def respond_with_cors(response: ServeResponse) -> None:
            await respond(self.apply(response, headers))

        return respond_with_cors

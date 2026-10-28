"""The core API: routes, and the pipeline every route runs through.

`Api.handle` is TypeScript's `api.handler`. Around every request, outermost
first, it applies:

1. request ids: a server-generated `x-request-id` on every response, and a
   caller's own id echoed only as `x-correlation-id`, after validation;
2. with an `HttpSecurity`, proxy trust, the raw `Host` check, trusted hosts and
   CORS (`security.py`): a preflight is answered there, and every other
   response to an allowed origin carries the CORS headers;
3. with a `ProductionProfile`, admission, the request deadline and the response
   byte ceiling (`production_limits.py`);
4. matching on method and path, then the route's pipeline.

`Api.dispatch` is the route's pipeline for a route an adapter has already
matched. A route's pipeline, in order:

1. authentication, unless the route is public, before any body byte is read;
2. the API's rate limits, then the route's, still before the body is read;
3. the body policy's header checks (encoding, declared length, media type);
4. for a route that takes input, the bounded body read, JSON decoding and
   validation;
5. the handler;
6. `cache-control: no-store` on an authenticated response, which answers for
   one caller and possibly one tenant and must never sit in a shared cache.

Whatever a step raises leaves in the canonical error envelope.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Protocol

from pydantic import TypeAdapter

from .auth import RequestAuth
from .authentication import Authentication
from .body import DEFAULT_MAX_BODY_BYTES, check_body_headers, read_input
from .errors import as_serve_error, error_response, not_found_message, serve_error
from .messages import ServeRequest, ServeResponse
from .openapi_info import OpenApiInfo
from .production import ProductionProfile
from .production_limits import ProductionGate
from .rate_limit import RateLimit
from .request_ids import new_request_id, with_request_ids
from .security import (
    INVALID_HOST,
    Cors,
    HttpSecurity,
    ProxyTrust,
    host_allowed,
    plain_text,
    raw_host_valid,
)
from .state import RequestState

if TYPE_CHECKING:
    from ..events import QueryEvents
    from .client_contract import ClientEndpointRegistry, ClientPlacement


_METHODS = frozenset(("GET", "POST", "PUT", "PATCH", "DELETE"))


@dataclass(frozen=True, slots=True, eq=False)
class Call:
    """One request reaching a route's handler, after authentication and input."""

    request: ServeRequest
    state: RequestState
    #: The caller. A public route is not authenticated, so it is usually None.
    auth: RequestAuth | None
    #: The validated body, for a route that takes input.
    input: object
    #: Where the route is served, for anything that depends on its public path.
    host: RouteHost


Handler = Callable[[Call], Awaitable[ServeResponse]]
#: Receives a request's answer: an adapter's writer, or `Api.handle`'s capture.
Responder = Callable[[ServeResponse], Awaitable[None]]


@dataclass(frozen=True, slots=True, eq=False)
class Route:
    method: str
    path: str
    handler: Handler
    public: bool = False
    #: The schema the body is validated against; None for a route without input,
    #: which never reads the body.
    input: TypeAdapter[object] | None = None
    #: Rate limits, applied in order after authentication and before the body.
    limits: tuple[RateLimit, ...] = ()
    #: For the development OpenAPI document: the response schema, a short
    #: summary and tags. A route with ``documented=False`` is left out of it.
    output: TypeAdapter[object] | None = None
    summary: str | None = None
    tags: tuple[str, ...] = ()
    documented: bool = True

    @property
    def name(self) -> str:
        """The handler's name, which names the route's OpenAPI operation."""

        return getattr(self.handler, "__name__", "route")


class RouteHost(Protocol):
    """Where an API's routes are served: the facts that depend on mounting.

    A client contract names each endpoint's public path, which depends on the
    application the API is mounted in, not on the API itself.
    """

    @property
    def mount_path(self) -> str: ...

    @property
    def production(self) -> ProductionProfile | None:
        """The profile a client contract is exported under."""
        ...

    def path_of(self, route: Route) -> str:
        """The one path *route* is served at; raises when that is ambiguous."""
        ...

    def registries(
        self, sources: tuple[ClientEndpointRegistry, ...]
    ) -> tuple[ClientEndpointRegistry, ...]:
        """The client registries a discovery route projects."""
        ...

    def placements(
        self, registries: tuple[ClientEndpointRegistry, ...]
    ) -> Sequence[ClientPlacement]:
        """The served POST routes a contract may describe, in serving order."""
        ...


class Api:
    """Routes and their pipeline, served by any adapter."""

    def __init__(
        self,
        *,
        authentication: Authentication,
        max_body_bytes: int = DEFAULT_MAX_BODY_BYTES,
        client_mount_path: str = "",
        security: HttpSecurity | None = None,
        production: ProductionProfile | None = None,
        base_path: str = "",
        limits: Sequence[RateLimit] = (),
        events: QueryEvents | None = None,
        openapi: OpenApiInfo | None = None,
    ) -> None:
        from .client_contract import ClientEndpointRegistry

        if type(authentication) is not Authentication:
            raise TypeError("an Api requires an Authentication")
        if type(max_body_bytes) is not int or max_body_bytes < 1:
            raise ValueError("max_body_bytes must be a positive integer")
        if type(client_mount_path) is not str:
            raise TypeError("client_mount_path must be a string")
        if security is not None and type(security) is not HttpSecurity:
            raise TypeError("security must be an HttpSecurity or None")
        if production is not None and type(production) is not ProductionProfile:
            raise TypeError("production must be a ProductionProfile or None")
        if type(base_path) is not str or (
            base_path and (not base_path.startswith("/") or base_path.endswith("/"))
        ):
            raise ValueError("base_path must be empty or start with '/' and not end with one")
        if not all(isinstance(limit, RateLimit) for limit in limits):
            raise TypeError("API limits must be RateLimit instances")
        if openapi is not None and type(openapi) is not OpenApiInfo:
            raise TypeError("openapi must be an OpenApiInfo")
        self.authentication = authentication
        self.max_body_bytes = max_body_bytes
        self.client_mount_path = client_mount_path
        self.client_endpoints = ClientEndpointRegistry(authentication)
        self._routes: list[Route] = []
        self.security = security
        self.production = production
        self.base_path = base_path
        self.limits = tuple(limits)
        #: The query-event sink of every endpoint installed without its own.
        self.events = events
        #: Describes the development OpenAPI document.
        self.openapi = openapi
        self._proxies = (
            ProxyTrust(security.trusted_proxies)
            if security is not None and security.trusted_proxies
            else None
        )
        self._cors = Cors(security.cors) if security is not None and security.cors else None
        self._gate = ProductionGate(production) if production is not None else None

    @property
    def routes(self) -> tuple[Route, ...]:
        return tuple(self._routes)

    def add_route(
        self,
        method: str,
        path: str,
        handler: Handler,
        *,
        public: bool = False,
        input: TypeAdapter[object] | None = None,  # noqa: A002 - the route's input
        limits: Sequence[RateLimit] = (),
        output: TypeAdapter[object] | None = None,
        summary: str | None = None,
        tags: Sequence[str] = (),
        documented: bool = True,
    ) -> Route:
        """Add a route at `base_path + path`; the first route for a method and path serves it.

        *handler* receives a `Call` and returns a `ServeResponse`. A route
        authenticates its caller unless *public*. A route with *input* reads
        the body, decodes it as JSON and validates it against that schema
        before the handler runs; any other route never reads the body.
        *output*, *summary* and *tags* describe the route in the development
        OpenAPI document.
        """

        if method not in _METHODS:
            raise ValueError(f"unsupported route method {method!r}")
        if type(path) is not str or not path.startswith("/"):
            raise ValueError("a route path must start with '/'")
        if type(public) is not bool:
            raise TypeError("public must be a boolean")
        if not all(isinstance(limit, RateLimit) for limit in limits):
            raise TypeError("route limits must be RateLimit instances")
        if not all(type(tag) is str for tag in tags) or isinstance(tags, str):
            raise TypeError("route tags must be strings")
        route = Route(
            method=method,
            path=self.base_path + path,
            handler=handler,
            public=public,
            input=input,
            limits=tuple(limits),
            output=output,
            summary=summary,
            tags=tuple(tags),
            documented=documented,
        )
        self._routes.append(route)
        return route

    def match(self, method: str, path: str) -> Route | None:
        for route in self._routes:
            if route.path == path and route.method == method:
                return route
        return None

    async def handle(
        self, request: ServeRequest, *, mounted_at: str | None = None
    ) -> ServeResponse:
        """Serve *request* through the security profile, budgets and its route.

        A path or method no route serves is `404 NOT_FOUND`, as in TypeScript,
        never a 405 that would list a route's methods to an anonymous caller.

        *mounted_at* is the prefix a host framework's router served the
        request under, for an adapter mounted inside one (Django's URLconf, a
        Flask blueprint): *request*'s path is below it, and client contracts
        name paths under it. The API's `client_mount_path`, when set, takes
        precedence, as trusted configuration of where the API is reached.
        """

        answered: list[ServeResponse] = []

        async def keep(response: ServeResponse) -> None:
            answered.append(response)

        await self.serve(request, keep, mounted_at=mounted_at)
        return answered[0]

    async def serve(
        self, request: ServeRequest, respond: Responder, *, mounted_at: str | None = None
    ) -> None:
        """Serve *request* as `handle` does, handing the answer to *respond*.

        For an adapter that writes to a transport. With a production profile,
        *respond* runs inside the request's admission slot and deadline, so a
        caller that will not read its answer cannot hold a response outside
        the server's concurrency or past its timeout. When the deadline
        passes while *respond* is writing, `TimeoutError` propagates: the
        response has started, and the transport must close the connection.
        """

        host = ApiHost(self, mounted_at)
        state = RequestState(request_id=new_request_id(), production=self.production)

        async def stamped(response: ServeResponse) -> None:
            await respond(with_request_ids(response, state.request_id, request.headers))

        await self._secured(request, state, host, stamped)

    async def _secured(
        self, request: ServeRequest, state: RequestState, host: ApiHost, respond: Responder
    ) -> None:
        if self._proxies is not None:
            client, _scheme = self._proxies.resolve(request.client, request.headers)
            if client != request.client:
                request = replace(request, client=client)
        if self.security is not None and not (
            raw_host_valid(request.headers)
            and host_allowed(request.headers, self.security.allowed_hosts)
        ):
            await respond(plain_text(INVALID_HOST, 400))
            return
        cors = self._cors
        if cors is not None:
            if cors.is_preflight(request.method, request.headers):
                await respond(cors.preflight(request.headers))
                return
            respond = cors.around(request.headers, respond)
        if self._gate is not None:
            await self._gate.run(state, lambda: self._route(request, state, host), respond)
        else:
            await respond(await self._route(request, state, host))

    async def _route(
        self, request: ServeRequest, state: RequestState, host: ApiHost
    ) -> ServeResponse:
        route = self.match(request.method, request.path)
        if route is None:
            error = serve_error(404, "NOT_FOUND", not_found_message(request.method, request.path))
            return error_response(error, state.request_id)
        return await self.dispatch(request, state, route, host)

    async def dispatch(
        self, request: ServeRequest, state: RequestState, route: Route, host: RouteHost
    ) -> ServeResponse:
        """Run *route*'s pipeline for a request an adapter has already matched."""

        try:
            # A public route sees only what the host already established for
            # this request; on its own, the core establishes nothing for it.
            auth = (
                state.authenticated() if route.public else await self.authentication(request, state)
            )
            for limit in (*self.limits, *route.limits):
                await limit.check(request, auth, route.path)
            checked_json = check_body_headers(request.headers, self.max_body_bytes)
            payload = None
            if route.input is not None:
                payload = await read_input(
                    request, route.input, self.max_body_bytes, checked_json=checked_json
                )
            response = await route.handler(Call(request, state, auth, payload, host))
        except Exception as exc:
            error = as_serve_error(exc, request_id=state.request_id)
            return error_response(error, state.request_id)
        if not route.public:
            response = response.with_headers({"cache-control": "no-store"})
        return response


class ApiHost:
    """An API served on its own: every route at its registered path.

    *mounted_at* is the prefix a host framework's router served the request
    under; the API's configured `client_mount_path` takes precedence.
    """

    __slots__ = ("_api", "_mounted_at")

    def __init__(self, api: Api, mounted_at: str | None = None) -> None:
        if mounted_at is not None and (
            type(mounted_at) is not str
            or (mounted_at and (not mounted_at.startswith("/") or mounted_at.endswith("/")))
        ):
            raise ValueError("mounted_at must be empty or start with '/' and not end with one")
        self._api = api
        self._mounted_at = mounted_at or ""

    @property
    def mount_path(self) -> str:
        return self._api.client_mount_path or self._mounted_at

    @property
    def production(self) -> ProductionProfile | None:
        return self._api.production

    def path_of(self, route: Route) -> str:
        return route.path

    def registries(
        self, sources: tuple[ClientEndpointRegistry, ...]
    ) -> tuple[ClientEndpointRegistry, ...]:
        return sources or (self._api.client_endpoints,)

    def placements(
        self, registries: tuple[ClientEndpointRegistry, ...]
    ) -> Sequence[ClientPlacement]:
        from .client_contract import ClientPlacement

        return [
            ClientPlacement(route=binding.route, path=binding.route.path)
            for registry in registries
            for binding in registry.bindings
            if binding.route is not None
        ]

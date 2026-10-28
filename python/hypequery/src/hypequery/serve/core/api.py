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
matched; the FastAPI layer uses it while its own middleware applies steps 1-3
around the routes the core does not serve, through the same policies
(decision 0023, step 2). A route's pipeline, in order:

1. authentication, unless the route is public, before any body byte is read;
2. the route's rate limits, still before the body is read;
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
from .errors import ErrorMapper, error_response, map_error, not_found_message, serve_error
from .messages import ServeRequest, ServeResponse
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
        error_mapper: ErrorMapper = map_error,
        security: HttpSecurity | None = None,
        production: ProductionProfile | None = None,
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
        self.authentication = authentication
        self.max_body_bytes = max_body_bytes
        self.client_mount_path = client_mount_path
        self.client_endpoints = ClientEndpointRegistry(authentication)
        self._error_mapper = error_mapper
        self._routes: list[Route] = []
        self.security = security
        self.production = production
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
    ) -> Route:
        """Add a route. As in FastAPI, the first route for a method and path serves it."""

        if method not in _METHODS:
            raise ValueError(f"unsupported route method {method!r}")
        if type(path) is not str or not path.startswith("/"):
            raise ValueError("a route path must start with '/'")
        if type(public) is not bool:
            raise TypeError("public must be a boolean")
        if not all(isinstance(limit, RateLimit) for limit in limits):
            raise TypeError("route limits must be RateLimit instances")
        route = Route(
            method=method,
            path=path,
            handler=handler,
            public=public,
            input=input,
            limits=tuple(limits),
        )
        self._routes.append(route)
        return route

    def match(self, method: str, path: str) -> Route | None:
        for route in self._routes:
            if route.path == path and route.method == method:
                return route
        return None

    async def handle(self, request: ServeRequest) -> ServeResponse:
        """Serve *request* through the security profile, budgets and its route.

        A path or method no route serves is `404 NOT_FOUND`, as in TypeScript,
        never a 405 that would list a route's methods to an anonymous caller.
        """

        state = RequestState(request_id=new_request_id(), production=self.production)
        response = await self._secured(request, state)
        return with_request_ids(response, state.request_id, request.headers)

    async def _secured(self, request: ServeRequest, state: RequestState) -> ServeResponse:
        if self._proxies is not None:
            client, _scheme = self._proxies.resolve(request.client, request.headers)
            if client != request.client:
                request = replace(request, client=client)
        if self.security is not None and not (
            raw_host_valid(request.headers)
            and host_allowed(request.headers, self.security.allowed_hosts)
        ):
            return plain_text(INVALID_HOST, 400)
        cors = self._cors
        if cors is not None and cors.is_preflight(request.method, request.headers):
            return cors.preflight(request.headers)
        if self._gate is not None:
            response = await self._gate.run(state, lambda: self._route(request, state))
        else:
            response = await self._route(request, state)
        return cors.apply(response, request.headers) if cors is not None else response

    async def _route(self, request: ServeRequest, state: RequestState) -> ServeResponse:
        route = self.match(request.method, request.path)
        if route is None:
            error = serve_error(404, "NOT_FOUND", not_found_message(request.method, request.path))
            return error_response(error, state.request_id)
        return await self.dispatch(request, state, route, ApiHost(self))

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
            for limit in route.limits:
                await limit.check(request, auth, route.path)
            checked_json = check_body_headers(request.headers, self.max_body_bytes)
            payload = None
            if route.input is not None:
                payload = await read_input(
                    request, route.input, self.max_body_bytes, checked_json=checked_json
                )
            response = await route.handler(Call(request, state, auth, payload, host))
        except Exception as exc:
            return error_response(self._error_mapper(exc, state.request_id), state.request_id)
        if not route.public:
            response = response.with_headers({"cache-control": "no-store"})
        return response


class ApiHost:
    """An API served on its own: every route at its registered path."""

    __slots__ = ("_api",)

    def __init__(self, api: Api) -> None:
        self._api = api

    @property
    def mount_path(self) -> str:
        return self._api.client_mount_path

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

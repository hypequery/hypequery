"""The core API: routes, and the pipeline every route runs through.

`Api.handle` is TypeScript's `api.handler`: it matches method and path, runs
the route, and stamps request ids. `Api.dispatch` is the same pipeline for a
route an adapter has already matched; the FastAPI layer uses it while its
security middleware still owns host checks, CORS, budgets and request-id
headers (decision 0023, steps 1-2).

A route's pipeline, in order:

1. authentication, unless the route is public, before any body byte is read;
2. the body policy's header checks (encoding, declared length, media type);
3. for a route that takes input, the bounded body read, JSON decoding and
   validation;
4. the handler;
5. `cache-control: no-store` on an authenticated response, which answers for
   one caller and possibly one tenant and must never sit in a shared cache.

Whatever a step raises leaves in the canonical error envelope.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from pydantic import TypeAdapter

from .auth import RequestAuth
from .authentication import Authentication
from .body import DEFAULT_MAX_BODY_BYTES, check_body_headers, read_input
from .errors import ErrorMapper, error_response, map_error, not_found_message, serve_error
from .messages import ServeRequest, ServeResponse
from .production import ProductionProfile
from .request_ids import new_request_id, with_request_ids
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
    ) -> None:
        from .client_contract import ClientEndpointRegistry

        if type(authentication) is not Authentication:
            raise TypeError("an Api requires an Authentication")
        if type(max_body_bytes) is not int or max_body_bytes < 1:
            raise ValueError("max_body_bytes must be a positive integer")
        if type(client_mount_path) is not str:
            raise TypeError("client_mount_path must be a string")
        self.authentication = authentication
        self.max_body_bytes = max_body_bytes
        self.client_mount_path = client_mount_path
        self.client_endpoints = ClientEndpointRegistry(authentication)
        self._error_mapper = error_mapper
        self._routes: list[Route] = []

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
    ) -> Route:
        """Add a route. As in FastAPI, the first route for a method and path serves it."""

        if method not in _METHODS:
            raise ValueError(f"unsupported route method {method!r}")
        if type(path) is not str or not path.startswith("/"):
            raise ValueError("a route path must start with '/'")
        if type(public) is not bool:
            raise TypeError("public must be a boolean")
        route = Route(method=method, path=path, handler=handler, public=public, input=input)
        self._routes.append(route)
        return route

    def match(self, method: str, path: str) -> Route | None:
        for route in self._routes:
            if route.path == path and route.method == method:
                return route
        return None

    async def handle(self, request: ServeRequest) -> ServeResponse:
        """Serve *request*: match, run the route's pipeline, stamp request ids.

        A path or method no route serves is `404 NOT_FOUND`, as in TypeScript,
        never a 405 that would list a route's methods to an anonymous caller.
        """

        state = RequestState(request_id=new_request_id())
        route = self.match(request.method, request.path)
        if route is None:
            error = serve_error(404, "NOT_FOUND", not_found_message(request.method, request.path))
            response = error_response(error, state.request_id)
        else:
            response = await self.dispatch(request, state, route, ApiHost(self))
        return with_request_ids(response, state.request_id, request.headers)

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
        return None

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

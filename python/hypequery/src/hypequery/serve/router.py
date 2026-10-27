"""The Hypequery APIRouter: every endpoint authenticated unless declared public.

Every API route authenticates the request before FastAPI reads its body, so an
unauthenticated caller cannot make the server read, parse, or spool anything.
The same check is also the route's first dependency, which keeps a route closed
even if its handler is replaced. A route is public only when the endpoint was
passed to `router.public` first.

Everything that would add a route without FastAPI dependencies is refused:
plain Starlette routes, host routes, mounts, static frontends, websockets, and
`include_router`, which in current FastAPI adds routes without going through
`add_api_route`. Refusing them is what makes "authenticated by default" true of
the whole router rather than of the routes that happened to be added one
particular way.

Hypequery's own endpoints (datasets, metrics, discovery) are served by the
framework-neutral core: FastAPI documents them and resolves their dependencies,
and the core reads, validates and answers the request (decision 0023, step 1).
"""

# No `from __future__ import annotations`: FastAPI 0.115 cannot resolve string
# annotations on a callable instance, which has no __globals__, and would read
# `_Guard.__call__`'s `request: Request` as a query parameter.
from collections.abc import Awaitable, Callable, Coroutine, Sequence
from typing import Any, NoReturn, TypeVar
from weakref import WeakKeyDictionary

from fastapi import APIRouter, Body, Depends, Request
from fastapi.params import Depends as DependsParam
from fastapi.routing import APIRoute
from starlette.datastructures import MutableHeaders
from starlette.responses import Response
from starlette.types import Message, Receive, Scope, Send

from .auth import (
    Authenticator,
    CredentialTransport,
    RequestAuth,
    TenantResolver,
    bearer_token,
    default_tenant_resolver,
)
from .body_policy import DEFAULT_MAX_BODY_BYTES, enforce_body_policy
from .client_contract import FastAPIHost
from .core.api import Api, Route
from .core.authentication import Authentication
from .core.client_contract import ClientEndpointRegistry
from .core.messages import ServeRequest
from .errors import as_serve_error, error_response, map_error
from .rate_limit import RateLimit
from .utils.scope_slot import ScopeSlot
from .utils.starlette_bridge import request_state, serve_request, starlette_response

_Endpoint = TypeVar("_Endpoint", bound=Callable[..., Any])

#: The endpoints whose requests the core serves, with the API and route that
#: serve them. FastAPI documents these routes and resolves their dependencies;
#: the core reads, validates and answers the request.
_CORE_ENDPOINTS: "WeakKeyDictionary[Callable[..., Any], tuple[Api, Route]]" = WeakKeyDictionary()
#: The request as received, for the core route FastAPI is about to call. Only
#: this module holds the slot.
_CORE_REQUEST: ScopeSlot[ServeRequest] = ScopeSlot(ServeRequest)


def authenticated_context(request: Request) -> RequestAuth | None:
    """The `RequestAuth` a route established for *request*, if any.

    Authentication results live in the request's core state, which only the
    core's `Authentication` writes, so no middleware, header, or request state
    can put a context where `router.auth` will read one.
    """

    return request_state(request).authenticated()


def core_route_of(route: object) -> Route | None:
    """The core route a FastAPI route is the documented face of, if any."""

    endpoint = getattr(route, "endpoint", None)
    found = _CORE_ENDPOINTS.get(endpoint) if callable(endpoint) else None
    return found[1] if found is not None else None


async def _empty_body() -> Message:
    return {"type": "http.request", "body": b"", "more_body": False}


class _Guard:
    """One router's authentication, usable as a FastAPI dependency.

    It runs the core's `Authentication`, whose results are kept per request
    and per router, so an endpoint that depends on another router's `auth` is
    authenticated by that router, never handed this one's result.
    """

    __slots__ = ("_authentication",)

    def __init__(self, authentication: Authentication) -> None:
        self._authentication = authentication

    async def __call__(self, request: Request) -> RequestAuth:
        return await self._authentication(serve_request(request), request_state(request))


class _AuthenticatingRoute(APIRoute):
    """An API route that authenticates before FastAPI reads the request body.

    FastAPI parses JSON and multipart bodies before it resolves any
    dependency, so a dependency alone lets an unauthenticated caller make the
    server read and parse, or spool to disk, whatever it sends.

    After authentication the body policy applies to every route, public ones
    included: JSON only, and no more than the router's limit. An
    authenticated response is marked `no-store`, because it answers for one
    caller and possibly one tenant, and a shared cache must never keep it.
    """

    max_body_bytes: int = DEFAULT_MAX_BODY_BYTES

    async def handle(self, scope: Scope, receive: Receive, send: Send) -> None:
        if any(isinstance(dep.dependency, _Guard) for dep in self.dependencies):

            async def send_no_store(message: Message) -> None:
                if message["type"] == "http.response.start":
                    MutableHeaders(scope=message)["Cache-Control"] = "no-store"
                await send(message)

            await super().handle(scope, receive, send_no_store)
            return
        await super().handle(scope, receive, send)

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()
        served_by_core = self.endpoint in _CORE_ENDPOINTS
        dependencies = [d.dependency for d in self.dependencies]
        guards = [d for d in dependencies if isinstance(d, _Guard)]
        # FastAPI also allows Depends(RateLimit(...)) on endpoint parameters.
        # Its dependency graph includes both forms, including nested ones.
        limits: list[RateLimit] = []
        pending = list(reversed(self.dependant.dependencies))
        while pending:
            dependency = pending.pop()
            if isinstance(dependency.call, RateLimit) and dependency.call not in limits:
                limits.append(dependency.call)
            pending.extend(reversed(dependency.dependencies))
        max_body_bytes = self.max_body_bytes

        async def guarded(request: Request) -> Response:
            # Everything a route can fail with leaves here in the canonical
            # envelope, including what the endpoint raises: nothing reaches
            # FastAPI's default handlers, which answer in another shape, or
            # Starlette's, which would answer outside the request-id middleware.
            try:
                for guard in guards:
                    await guard(request)
                # Default keys need only the authenticated context. Custom
                # keys may need state prepared by earlier dependencies, so
                # leave them and later limits to FastAPI's normal order.
                for limit in limits:
                    if not limit.can_run_before_body:
                        break
                    await limit(request)
                if served_by_core:
                    # FastAPI resolves the route's dependencies with no body;
                    # the core then reads it under its own body policy.
                    _CORE_REQUEST.set(request.scope, serve_request(request))
                    return await handler(Request(request.scope, _empty_body))
                return await handler(enforce_body_policy(request, max_body_bytes))
            except Exception as exc:
                return error_response(request, as_serve_error(exc, request=request))

        return guarded


class ServeRouter(APIRouter):
    """An APIRouter whose routes require authentication unless marked public.

    Endpoints read the authenticated context by depending on `router.auth`,
    which reuses the route's own check rather than authenticating twice.
    """

    def __init__(
        self,
        *,
        authenticate: Authenticator,
        credentials: CredentialTransport,
        resolve_tenant: TenantResolver,
        prefix: str = "",
        tags: list[str] | None = None,
        max_body_bytes: int = DEFAULT_MAX_BODY_BYTES,
    ) -> None:
        # One route class per router, carrying that router's body limit. It is
        # a class rather than a value because FastAPI takes a route class.
        route_class = type(
            "ServeRoute", (_AuthenticatingRoute,), {"max_body_bytes": max_body_bytes}
        )
        super().__init__(prefix=prefix, tags=list(tags or ()), route_class=route_class)
        self._auth_route_class = route_class
        self._public: set[Callable[..., Any]] = set()
        self._api = Api(
            authentication=Authentication(authenticate, credentials, resolve_tenant),
            max_body_bytes=max_body_bytes,
            error_mapper=map_error,
        )
        self._guard = _Guard(self._api.authentication)
        self._credential_header = credentials.header
        self.client_endpoints: ClientEndpointRegistry = self._api.client_endpoints

    @property
    def credential_header(self) -> str:
        """Credential transport, for production startup validation."""
        return self._credential_header

    @property
    def auth(self) -> Callable[[Request], Awaitable[RequestAuth]]:
        """The dependency an endpoint uses to read its `RequestAuth`.

        Read-only: a route added later can never be guarded by something else.
        """

        return self._guard

    def public(self, endpoint: _Endpoint) -> _Endpoint:
        """Mark *endpoint* public on this router. Apply it below the route decorator.

        ```python
        @router.get("/health")
        @router.public
        def health() -> dict[str, str]: ...
        ```

        In the other order the route is registered first and stays
        authenticated, which is the safe way to get it wrong.
        """

        self._public.add(endpoint)
        return endpoint

    def add_api_route(
        self,
        path: str,
        endpoint: Callable[..., Any],
        *,
        dependencies: Sequence[DependsParam] | None = None,
        **kwargs: Any,
    ) -> None:
        route_class = kwargs.get("route_class_override") or self.route_class
        if route_class is not self._auth_route_class:
            # Only the router's own class is trusted to retain the guard
            # dependencies that run before FastAPI parses the request body.
            raise TypeError("ServeRouter requires its authenticating route class")
        guarded = list(dependencies or ())
        if endpoint not in self._public:
            guarded.insert(0, Depends(self._guard))
        super().add_api_route(path, endpoint, dependencies=guarded, **kwargs)

    def _add_core_route(
        self, path: str, route: Route, *, documented_input: Any = None, **kwargs: Any
    ) -> None:
        """Serve the core *route* at *path* on this router.

        FastAPI documents it, with *documented_input* as its request body, and
        resolves its dependencies; the core reads and validates the body and
        answers. Internal to this package.
        """

        api = self._api
        if route.path != self.prefix + path or route not in api.routes:
            raise ValueError("a core route is served at its own API's path")

        async def endpoint(request: Request) -> Response:
            return await _serve_core_route(request, api, route)

        if documented_input is not None:
            # The default only keeps FastAPI from reading the body; the core
            # requires one, and the schema says so.
            async def endpoint_with_body(
                request: Request,
                payload: Any = Body(None),  # noqa: B008 - FastAPI's parameter declaration
            ) -> Response:
                return await _serve_core_route(request, api, route)

            endpoint_with_body.__annotations__["payload"] = documented_input
            kwargs["openapi_extra"] = {"requestBody": {"required": True}}
            endpoint = endpoint_with_body
        # FastAPI names the operation after its endpoint: keep the handler's.
        endpoint.__name__ = endpoint.__qualname__ = route.handler.__name__
        _CORE_ENDPOINTS[endpoint] = (api, route)
        if route.public:
            self.public(endpoint)
        self.add_api_route(path, endpoint, methods=[route.method], **kwargs)

    def _post_path_taken(self, path: str) -> bool:
        """Whether a POST route on this router already serves *path* (prefix included)."""

        return any(
            getattr(route, "path", None) == path and "POST" in getattr(route, "methods", ())
            for route in self.routes
        )

    def include_router(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise TypeError(
            "ServeRouter does not include other routers: their routes would not be "
            "authenticated. Include both routers in the application instead."
        )

    def add_route(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise TypeError("ServeRouter only serves API routes; a plain route skips authentication")

    def mount(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise TypeError("ServeRouter does not mount applications; they skip authentication")

    def host(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise TypeError("ServeRouter does not add host routes; they skip authentication")

    def frontend(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise TypeError(
            "ServeRouter does not serve static frontends; they skip authentication. "
            "Serve them from the application or another router."
        )

    def add_websocket_route(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise TypeError("ServeRouter does not serve websockets")

    def add_api_websocket_route(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise TypeError("ServeRouter does not serve websockets")


def create_api(
    *,
    authenticate: Authenticator,
    credentials: CredentialTransport | None = None,
    resolve_tenant: TenantResolver | None = None,
    prefix: str = "",
    tags: list[str] | None = None,
    max_body_bytes: int = DEFAULT_MAX_BODY_BYTES,
) -> ServeRouter:
    """Create the router Hypequery endpoints are served from.

    *authenticate* receives the opaque credential and returns the `Principal`.
    It rejects a credential by returning None or raising `InvalidCredential`;
    any other exception is treated as authentication being unavailable. It may
    be sync or async. *credentials* is where the
    credential is read from, `bearer_token()` by default. *resolve_tenant*
    maps a principal to its tenant capability; by default a principal's
    `tenant_id` scopes the request and a principal without one is tenant-free.
    *max_body_bytes* bounds every request body, 1 MiB by default.
    """

    if type(max_body_bytes) is not int or max_body_bytes < 1:
        raise ValueError("max_body_bytes must be a positive integer")

    if not callable(authenticate):
        raise TypeError("create_api requires an authenticate callable")
    if resolve_tenant is not None and not callable(resolve_tenant):
        raise TypeError("resolve_tenant must be callable")
    if credentials is not None and type(credentials) is not CredentialTransport:
        raise TypeError("credentials must come from bearer_token() or api_key()")
    return ServeRouter(
        authenticate=authenticate,
        credentials=credentials or bearer_token(),
        resolve_tenant=resolve_tenant or default_tenant_resolver,
        prefix=prefix,
        tags=tags,
        max_body_bytes=max_body_bytes,
    )


async def _serve_core_route(request: Request, api: Api, route: Route) -> Response:
    received = _CORE_REQUEST.get(request.scope)
    if received is None:
        raise RuntimeError("a core route ran outside its authenticating route")
    response = await api.dispatch(received, request_state(request), route, FastAPIHost(request))
    return starlette_response(response)


__all__ = ["ServeRouter", "create_api", "create_router"]


#: The Python spelling of `create_api`, which matches TypeScript's `createAPI`.
create_router = create_api

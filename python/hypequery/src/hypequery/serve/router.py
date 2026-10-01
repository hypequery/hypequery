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
"""

# No `from __future__ import annotations`: FastAPI 0.115 cannot resolve string
# annotations on a callable instance, which has no __globals__, and would read
# `_Guard.__call__`'s `request: Request` as a query parameter.
import inspect
from collections.abc import Awaitable, Callable, Coroutine, MutableMapping, Sequence
from typing import Any, NoReturn, TypeVar, cast

from fastapi import APIRouter, Depends, Request
from fastapi.params import Depends as DependsParam
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response

from ..datasets.planner import TenantScope
from .auth import (
    Authenticator,
    CredentialTransport,
    InvalidCredential,
    Principal,
    RequestAuth,
    TenantResolver,
    bearer_token,
    default_tenant_resolver,
    misconfigured,
    read_credential,
    unauthenticated,
    unavailable,
)

_Endpoint = TypeVar("_Endpoint", bound=Callable[..., Any])
_Argument = TypeVar("_Argument")
_Result = TypeVar("_Result")

#: Where a route leaves the auth context for its dependencies. Only this module
#: holds the key, and it is not a string, so no middleware, header, or request
#: state can put a context where `router.auth` will read one.
_AUTH_SCOPE_KEY = object()


def _authenticated_by(request: Request) -> "dict[_Guard, RequestAuth]":
    scope = cast(MutableMapping[object, Any], request.scope)
    found = scope.get(_AUTH_SCOPE_KEY)
    if type(found) is not dict:
        found = {}
        scope[_AUTH_SCOPE_KEY] = found
    return found


class _Guard:
    """One router's authentication, usable as a FastAPI dependency.

    Results are kept per guard, so an endpoint that depends on another
    router's `auth` is authenticated by that router, never handed this one's
    result.
    """

    __slots__ = ("_authenticate", "_credentials", "_resolve_tenant")

    def __init__(
        self,
        authenticate: Authenticator,
        credentials: CredentialTransport,
        resolve_tenant: TenantResolver,
    ) -> None:
        self._authenticate = authenticate
        self._credentials = credentials
        self._resolve_tenant = resolve_tenant

    async def __call__(self, request: Request) -> RequestAuth:
        results = _authenticated_by(request)
        cached = results.get(self)
        if type(cached) is RequestAuth:
            return cached
        auth = await self._run(request)
        results[self] = auth
        return auth

    async def _run(self, request: Request) -> RequestAuth:
        credential = read_credential(request, self._credentials)
        if credential is None:
            raise unauthenticated(self._credentials)
        try:
            principal = await _call_provider(self._authenticate, credential, rejectable=True)
        except InvalidCredential:
            raise unauthenticated(self._credentials) from None
        if principal is None:
            raise unauthenticated(self._credentials)
        if type(principal) is not Principal:
            raise misconfigured()
        scope = await _call_provider(self._resolve_tenant, principal)
        if scope is not None and (
            type(scope) is not TenantScope or scope.cross_tenant or len(scope.ids) != 1
        ):
            raise misconfigured()
        return RequestAuth(principal=principal, tenant=scope)


class _AuthenticatingRoute(APIRoute):
    """An API route that authenticates before FastAPI reads the request body.

    FastAPI parses JSON and multipart bodies before it resolves any
    dependency, so a dependency alone lets an unauthenticated caller make the
    server read and parse, or spool to disk, whatever it sends.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()
        guards = [d.dependency for d in self.dependencies if isinstance(d.dependency, _Guard)]
        if not guards:
            return handler

        async def authenticate_first(request: Request) -> Response:
            for guard in guards:
                await guard(request)
            return await handler(request)

        return authenticate_first


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
    ) -> None:
        super().__init__(prefix=prefix, tags=list(tags or ()), route_class=_AuthenticatingRoute)
        self._auth_route_class = _AuthenticatingRoute
        self._public: set[Callable[..., Any]] = set()
        self._guard = _Guard(authenticate, credentials, resolve_tenant)

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


def _is_async(provider: Callable[..., object]) -> bool:
    call = getattr(provider, "__call__", None)  # noqa: B004 - a callable instance's method
    return inspect.iscoroutinefunction(provider) or inspect.iscoroutinefunction(call)


async def _call_provider(
    provider: Callable[[_Argument], _Result | Awaitable[_Result]],
    argument: _Argument,
    *,
    rejectable: bool = False,
) -> _Result:
    """Run a host provider, failing closed and silent if it raises.

    An authenticator rejects a credential by returning None or raising
    `InvalidCredential`; with *rejectable* that exception passes through for
    the caller to answer 401. Any other exception, even an HTTPException, is
    the provider failing.

    A sync provider runs in the threadpool, as FastAPI runs a sync dependency:
    a token lookup that blocks must not stall every request on the loop.
    """

    try:
        if _is_async(provider):
            result = provider(argument)
        else:
            result = await run_in_threadpool(provider, argument)
        if inspect.isawaitable(result):
            return await result
        return result
    except InvalidCredential:
        if rejectable:
            raise
        raise unavailable() from None
    except Exception as exc:
        # The provider's exception may carry a token, a claim, or a backend
        # address. It stays the cause for a trusted debugger and never
        # becomes response content.
        raise unavailable() from exc


def create_router(
    *,
    authenticate: Authenticator,
    credentials: CredentialTransport | None = None,
    resolve_tenant: TenantResolver | None = None,
    prefix: str = "",
    tags: list[str] | None = None,
) -> ServeRouter:
    """Create the router Hypequery endpoints are served from.

    *authenticate* receives the opaque credential and returns the `Principal`.
    It rejects a credential by returning None or raising `InvalidCredential`;
    any other exception is treated as authentication being unavailable. It may
    be sync or async. *credentials* is where the
    credential is read from, `bearer_token()` by default. *resolve_tenant*
    maps a principal to its tenant capability; by default a principal's
    `tenant_id` scopes the request and a principal without one is tenant-free.
    """

    if not callable(authenticate):
        raise TypeError("create_router requires an authenticate callable")
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
    )


__all__ = ["ServeRouter", "create_router"]

"""The Hypequery APIRouter: every endpoint authenticated unless declared public.

Authentication is a dependency attached to each API route as it is added, so it
runs before the endpoint and before any dependency the endpoint declares. A
route is public only when the endpoint was passed to `router.public` first.

Everything that would add a route without FastAPI dependencies is refused:
plain Starlette routes, mounts, websockets, and `include_router`, which in
current FastAPI adds routes without going through `add_api_route`. Refusing
them is what makes "authenticated by default" true of the whole router rather
than of the routes that happened to be added one particular way.
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Sequence
from typing import Any, NoReturn, TypeVar

from fastapi import APIRouter, Depends, Request
from fastapi.params import Depends as DependsParam
from starlette.concurrency import run_in_threadpool

from ..datasets.planner import TenantScope
from .auth import (
    Authenticator,
    CredentialTransport,
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


class ServeRouter(APIRouter):
    """An APIRouter whose routes require authentication unless marked public.

    Endpoints read the authenticated context by depending on `router.auth`.
    FastAPI caches a dependency per request, so this reuses the result of the
    route's own check rather than authenticating twice.
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
        super().__init__(prefix=prefix, tags=list(tags or ()))
        self._public: set[Callable[..., Any]] = set()
        self.auth = self._auth_dependency(authenticate, credentials, resolve_tenant)

    @staticmethod
    def _auth_dependency(
        authenticate: Authenticator,
        credentials: CredentialTransport,
        resolve_tenant: TenantResolver,
    ) -> Callable[[Request], Awaitable[RequestAuth]]:
        async def authenticated(request: Request) -> RequestAuth:
            credential = read_credential(request, credentials)
            if credential is None:
                raise unauthenticated(credentials)
            principal = await _call_provider(authenticate, credential)
            if principal is None:
                raise unauthenticated(credentials)
            if type(principal) is not Principal:
                raise misconfigured()
            scope = await _call_provider(resolve_tenant, principal)
            if scope is not None and (type(scope) is not TenantScope or scope.cross_tenant):
                raise misconfigured()
            return RequestAuth(principal=principal, tenant=scope)

        return authenticated

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
        guarded = list(dependencies or ())
        if endpoint not in self._public:
            guarded.insert(0, Depends(self.auth))
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

    def add_websocket_route(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise TypeError("ServeRouter does not serve websockets")

    def add_api_websocket_route(self, *args: Any, **kwargs: Any) -> NoReturn:
        raise TypeError("ServeRouter does not serve websockets")


def _is_async(provider: Callable[..., object]) -> bool:
    call = getattr(provider, "__call__", None)  # noqa: B004 - a callable instance's method
    return inspect.iscoroutinefunction(provider) or inspect.iscoroutinefunction(call)


async def _call_provider(
    provider: Callable[[_Argument], _Result | Awaitable[_Result]], argument: _Argument
) -> _Result:
    """Run a host provider, failing closed and silent if it raises.

    Rejecting a credential is returning None. Raising, even an HTTPException,
    is treated as the provider failing.

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

    *authenticate* receives the opaque credential and returns the `Principal`,
    or None to reject it. It may be sync or async. *credentials* is where the
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

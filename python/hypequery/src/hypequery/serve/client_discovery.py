"""Bounded principal-scoped discovery of installed client-contract capabilities."""

from __future__ import annotations

from collections.abc import Sequence

from .core.client_discovery import add_client_contract_route
from .policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy
from .router import ServeRouter


def add_client_contract_endpoint(
    router: ServeRouter,
    path: str = "/client-contract",
    *,
    routers: Sequence[ServeRouter] = (),
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
    max_bytes: int = 256 * 1024,
) -> None:
    """Register an authenticated live view, independently authorizing every target.

    Public discovery is explicit and projects only anonymous/public capabilities,
    following ServeRouter's public-route authentication semantics. A custom
    FastAPI host supplies the routers whose installed bindings may be projected.
    Build views and host configuration are never selectable from request input.
    """
    route = add_client_contract_route(
        router._api,
        router.prefix + path,
        sources=tuple(source.client_endpoints for source in routers),
        policy=policy,
        max_bytes=max_bytes,
    )
    router._add_core_route(path, route, tags=["discovery"])

"""Bounded principal-scoped discovery of installed client-contract capabilities."""

from __future__ import annotations

from .core.api import Api
from .core.client_discovery import add_client_contract_route
from .policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy


def add_client_contract_endpoint(
    api: Api,
    path: str = "/client-contract",
    *,
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
    max_bytes: int = 256 * 1024,
) -> None:
    """Register an authenticated live view of *api*'s strict client endpoints.

    Public discovery is explicit and projects only anonymous/public
    capabilities, following the API's public-route authentication semantics.
    Build views and host configuration are never selectable from request input.
    """

    add_client_contract_route(api, path, policy=policy, max_bytes=max_bytes, tags=("discovery",))

"""Discovery registered under the same endpoint policy as execution."""

from __future__ import annotations

from ..datasets.registry import DatasetRegistry
from .core.discovery import add_discovery_route
from .policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy
from .router import ServeRouter


def add_discovery_endpoint(
    router: ServeRouter,
    path: str = "/discovery",
    *,
    registry: DatasetRegistry,
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
    max_bytes: int = 256 * 1024,
) -> None:
    """Freeze a bounded, physical-detail-free projection at registration."""

    route = add_discovery_route(
        router._api, router.prefix + path, registry=registry, policy=policy, max_bytes=max_bytes
    )
    router._add_core_route(path, route, tags=["discovery"])

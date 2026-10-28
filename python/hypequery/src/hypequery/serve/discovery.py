"""Discovery registered under the same endpoint policy as execution."""

from __future__ import annotations

from ..datasets.registry import DatasetRegistry
from .core.api import Api
from .core.discovery import add_discovery_route
from .policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy


def add_discovery_endpoint(
    api: Api,
    path: str = "/discovery",
    *,
    registry: DatasetRegistry,
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
    max_bytes: int = 256 * 1024,
) -> None:
    """Freeze a bounded, physical-detail-free projection at registration."""

    add_discovery_route(
        api, path, registry=registry, policy=policy, max_bytes=max_bytes, tags=("discovery",)
    )

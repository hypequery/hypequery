"""Discovery served under the same endpoint policy as execution."""

from __future__ import annotations

from ...datasets.registry import DatasetRegistry
from ..utils.discovery import public_discovery
from .api import Api, Call, Route
from .messages import ServeResponse
from .policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy


def add_discovery_route(
    api: Api,
    path: str,
    *,
    registry: DatasetRegistry,
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
    max_bytes: int = 256 * 1024,
) -> Route:
    """Freeze a bounded, physical-detail-free projection at registration."""

    projection = public_discovery(registry, max_bytes)

    async def discover(call: Call) -> ServeResponse:
        policy.authorize(call.auth)
        return ServeResponse.json(projection)

    return api.add_route("GET", path, discover, public=policy.public)

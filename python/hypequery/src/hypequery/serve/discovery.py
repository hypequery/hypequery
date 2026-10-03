"""Discovery registered under the same endpoint policy as execution."""

from __future__ import annotations

from fastapi import Request
from starlette.responses import JSONResponse

from ..datasets.registry import DatasetRegistry
from .policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy
from .router import ServeRouter, authenticated_context
from .utils.discovery import public_discovery


def add_discovery_endpoint(
    router: ServeRouter,
    path: str = "/discovery",
    *,
    registry: DatasetRegistry,
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
    max_bytes: int = 256 * 1024,
) -> None:
    """Freeze a bounded, physical-detail-free projection at registration."""

    projection = public_discovery(registry, max_bytes)

    async def discover(request: Request) -> JSONResponse:
        policy.authorize(authenticated_context(request))
        return JSONResponse(projection)

    if policy.public:
        router.public(discover)
    router.add_api_route(path, discover, methods=["GET"], tags=["discovery"])

"""Bounded principal-scoped discovery of installed client-contract capabilities."""

from __future__ import annotations

from collections.abc import Sequence

from fastapi import Request
from starlette.responses import Response

from ..protocol import ProtocolClientContractError
from .auth import RequestAuth
from .client_contract import ClientEndpointRegistry, client_registries, export_client_contract
from .errors import ServeError
from .policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy
from .router import ServeRouter, authenticated_context


async def target_auth(registry: ClientEndpointRegistry, request: Request) -> RequestAuth | None:
    """Authenticate *request* with the registry's own router; None when refused."""
    if registry.guard is None:
        return None
    try:
        return await registry.guard(request)
    except ServeError as error:
        if error.status_code in (401, 403):
            return None
        raise


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
    if type(max_bytes) is not int or not 1 <= max_bytes <= 1_048_576:
        raise ValueError("max_bytes must be an integer between 1 and 1048576")
    sources = tuple(routers)

    async def discover(request: Request) -> Response:
        policy.authorize(authenticated_context(request))
        auths: dict[ClientEndpointRegistry, RequestAuth | None] = {}
        if not policy.public:
            # Each target is authorized by its own router: a credential accepted
            # by discovery must not reveal another router's endpoints.
            for registry in client_registries(request.app, sources):
                auths[registry] = await target_auth(registry, request)
        try:
            artifact = export_client_contract(
                request.app, routers=sources, view="authorized", auths=auths
            )
        except ProtocolClientContractError:
            raise ServeError(
                503, "SERVICE_UNAVAILABLE", "Client discovery is unavailable."
            ) from None
        body = artifact["canonical"].encode("utf-8")
        if len(body) > max_bytes:
            raise ServeError(503, "SERVICE_UNAVAILABLE", "Client discovery is unavailable.")
        return Response(
            body,
            media_type="application/json",
            headers={
                "Cache-Control": "no-store",
                "Vary": router.credential_header,
            },
        )

    if policy.public:
        router.public(discover)
    router.add_api_route(path, discover, methods=["GET"], tags=["discovery"])

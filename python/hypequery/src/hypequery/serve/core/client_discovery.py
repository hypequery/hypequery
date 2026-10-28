"""Bounded principal-scoped discovery of installed client-contract capabilities."""

from __future__ import annotations

from ...protocol import ProtocolClientContractError
from .api import Api, Call, Route
from .auth import RequestAuth
from .client_contract import ClientEndpointRegistry, export_placements
from .errors import ServeHttpError, serve_error
from .messages import ServeResponse
from .policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy


async def target_auth(registry: ClientEndpointRegistry, call: Call) -> RequestAuth | None:
    """Authenticate the request with the registry's own API; None when refused."""
    try:
        return await registry.authentication(call.request, call.state)
    except ServeHttpError as error:
        if error.status_code in (401, 403):
            return None
        raise


def add_client_contract_route(
    api: Api,
    path: str = "/client-contract",
    *,
    sources: tuple[ClientEndpointRegistry, ...] = (),
    policy: EndpointPolicy = DEFAULT_ENDPOINT_POLICY,
    max_bytes: int = 256 * 1024,
) -> Route:
    """Serve a live view of *sources*, independently authorizing every target.

    Public discovery is explicit and projects only anonymous/public
    capabilities. With no *sources*, the host decides which registries it
    serves. Build views and host configuration are never selectable from
    request input.
    """
    if type(max_bytes) is not int or not 1 <= max_bytes <= 1_048_576:
        raise ValueError("max_bytes must be an integer between 1 and 1048576")

    async def discover(call: Call) -> ServeResponse:
        policy.authorize(call.auth)
        registries = call.host.registries(sources)
        auths: dict[ClientEndpointRegistry, RequestAuth | None] = {}
        if not policy.public:
            # Each target is authorized by its own API: a credential accepted
            # by discovery must not reveal another API's endpoints.
            for registry in registries:
                auths[registry] = await target_auth(registry, call)
        try:
            artifact = export_placements(
                registries,
                call.host.placements(registries),
                production=call.host.production,
                mount_path=call.host.mount_path,
                view="authorized",
                auths=auths,
            )
        except ProtocolClientContractError:
            raise serve_error(
                503, "SERVICE_UNAVAILABLE", "Client discovery is unavailable."
            ) from None
        body = artifact["canonical"].encode("utf-8")
        if len(body) > max_bytes:
            raise serve_error(503, "SERVICE_UNAVAILABLE", "Client discovery is unavailable.")
        return ServeResponse.encoded(
            body,
            headers={
                "cache-control": "no-store",
                "vary": api.authentication.credentials.header,
            },
        )

    return api.add_route("GET", path, discover, public=policy.public)

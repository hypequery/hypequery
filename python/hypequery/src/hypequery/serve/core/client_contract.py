"""API-owned semantic endpoint bindings and strict client execution preconditions."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Literal

from ...datasets import ClientEndpointDefinition, ClientQueryProfile, Dataset
from ...datasets import export_client_contract as export_definition_contract
from ...datasets.client import AsyncDatasetClient, DatasetClient
from ...datasets.client_contract.export import export_registered_client_contract
from ...datasets.registry import DatasetRegistry
from ...protocol import (
    PreparedProtocolClientContract,
    ProtocolClientContractError,
    validate_protocol_client_query,
)
from ..utils.client_contract_view import client_contract_view
from .auth import RequestAuth
from .authentication import Authentication
from .errors import ServeHttpError, serve_error
from .policy import EndpointPolicy
from .production import ProductionProfile

if TYPE_CHECKING:
    from .api import Call, Route


@dataclass(frozen=True, slots=True)
class ClientEndpointBinding:
    """Immutable registration metadata; the route's handler owns execution state."""

    dataset: Dataset
    client: DatasetClient | AsyncDatasetClient
    policy: EndpointPolicy
    profile: ClientQueryProfile
    path: str
    measure: str | None = None
    name: str | None = None
    route: Route | None = None
    related: frozenset[str] = frozenset()

    def definition(
        self, path: str, production: ProductionProfile | None
    ) -> ClientEndpointDefinition:
        maximum = min(
            self.profile.max_limit, self.policy.max_limit, self.client.result_row_limit - 1
        )
        if production is not None:
            maximum = min(maximum, production.max_result_rows - 1)
        return ClientEndpointDefinition(
            dataset=self.dataset,
            path=path,
            measure=self.measure,
            name=self.name,
            related=self.related,
            profile=replace(
                self.profile, max_limit=maximum, default_timezone=self.client.default_timezone
            ),
        )

    def contract(
        self, path: str, production: ProductionProfile | None, mount_path: str = ""
    ) -> PreparedProtocolClientContract:
        return export_definition_contract(
            [self.definition(path, production)],
            registry=self.client.registry,
            mount_path=mount_path,
        )

    def validate(self, call: Call, payload: object) -> dict[str, object]:
        """Called after current endpoint policy; no query is planned before this check."""
        if self.route is None:
            raise RuntimeError("client endpoint requires a registered route")
        path = call.host.path_of(self.route)
        contract = self.contract(path, call.state.production, call.host.mount_path)["contract"]
        expected = call.request.headers.get("x-hypequery-client-schema")
        if expected is not None and expected != contract["endpoints"][0]["schemaHash"]:
            raise serve_error(
                409,
                "VALIDATION_ERROR",
                "Client endpoint schema changed.",
                details={"code": "CLIENT_SCHEMA_CHANGED"},
            )
        try:
            body = validate_protocol_client_query(
                contract, contract["endpoints"][0]["id"], payload
            )["body"]
            time = contract["endpoints"][0]["time"]
            if time is not None:
                body.setdefault("timezone", time["defaultTimezone"])
            return body
        except ProtocolClientContractError:
            raise serve_error(400, "VALIDATION_ERROR", "Invalid client query.") from None


class ClientEndpointRegistry:
    """Owning registry for opted-in endpoints, frozen per installed binding."""

    def __init__(self, authentication: Authentication) -> None:
        self._bindings: list[ClientEndpointBinding] = []
        #: The owning API's authentication; discovery authenticates each source
        #: with its own rather than trusting another API's result.
        self.authentication = authentication

    @property
    def bindings(self) -> tuple[ClientEndpointBinding, ...]:
        return tuple(self._bindings)

    def check(self, binding: ClientEndpointBinding) -> None:
        descriptor = binding.contract(binding.path, None)["contract"]["endpoints"][0]
        for previous in self._bindings:
            prior = previous.contract(previous.path, None)["contract"]["endpoints"][0]
            if prior["id"] == descriptor["id"] or previous.path == binding.path:
                raise ValueError("client endpoint IDs and paths must be unique")

    def register(self, binding: ClientEndpointBinding) -> None:
        self.check(binding)
        self._bindings.append(binding)

    def find(
        self, route: object, *, authorized: bool = False, auth: RequestAuth | None = None
    ) -> ClientEndpointBinding | None:
        for binding in self._bindings:
            if binding.route is not route:
                continue
            if authorized:
                try:
                    # Public routes run without authentication or a tenant.
                    binding.policy.authorize(None if binding.policy.public else auth)
                except ServeHttpError as error:
                    if error.status_code in (401, 403):
                        return None
                    raise
            return binding
        return None


@dataclass(frozen=True, slots=True)
class ClientPlacement:
    """A served POST route and the path it is served at."""

    #: The core route, matched by identity against registered bindings.
    route: object
    path: str
    #: Whether another served route could answer the same path.
    ambiguous: bool = False


def export_placements(
    registries: tuple[ClientEndpointRegistry, ...],
    placements: Sequence[ClientPlacement],
    *,
    production: ProductionProfile | None,
    mount_path: str,
    view: Literal["build", "authorized"] = "build",
    auths: Mapping[ClientEndpointRegistry, RequestAuth | None] | None = None,
) -> PreparedProtocolClientContract:
    """The contract for the opted-in endpoints among *placements*.

    An authorized view checks each target against *auths*, the request's
    authentication by that target's own API (None when it was refused).
    """

    if view not in ("build", "authorized"):
        raise ValueError("client export view must be build or authorized")
    definitions: list[tuple[ClientEndpointDefinition, DatasetRegistry | None]] = []
    seen_paths: set[str] = set()
    for placement in placements:
        binding = next(
            (
                found
                for registry in registries
                if (
                    found := registry.find(
                        placement.route,
                        authorized=view == "authorized",
                        auth=(auths or {}).get(registry),
                    )
                )
                is not None
            ),
            None,
        )
        if binding is None:
            continue
        if placement.path in seen_paths or placement.ambiguous:
            raise ValueError("client export refuses ambiguous POST route paths")
        seen_paths.add(placement.path)
        definitions.append(
            (binding.definition(placement.path, production), binding.client.registry)
        )
    prepared = export_registered_client_contract(definitions, mount_path=mount_path)
    return client_contract_view(prepared, view)

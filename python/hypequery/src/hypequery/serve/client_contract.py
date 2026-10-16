"""Router-owned semantic endpoint bindings and strict client execution preconditions."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, cast

from fastapi import FastAPI, Request
from fastapi.routing import APIRoute, iter_route_contexts

from ..datasets import ClientEndpointDefinition, ClientQueryProfile, Dataset
from ..datasets import export_client_contract as export_definition_contract
from ..datasets.client import AsyncDatasetClient, DatasetClient
from ..protocol import (
    PreparedProtocolClientContract,
    ProtocolClientContractError,
    validate_protocol_client_query,
)
from .errors import ServeError
from .policy import EndpointPolicy
from .production import ProductionProfile
from .utils.client_route_conflicts import client_route_conflicts
from .utils.production_context import production_profile

if TYPE_CHECKING:
    from .router import ServeRouter


@dataclass(frozen=True, slots=True)
class ClientEndpointBinding:
    """Immutable registration metadata; the route closure owns execution state."""

    dataset: Dataset
    client: DatasetClient | AsyncDatasetClient
    policy: EndpointPolicy
    profile: ClientQueryProfile
    handler: object
    path: str
    measure: str | None = None
    name: str | None = None
    route: object | None = None

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

    def validate(self, request: Request, payload: dict[str, object]) -> dict[str, object]:
        """Called after current endpoint policy; no query is planned before this check."""
        route = request.scope.get("route")
        if not isinstance(route, APIRoute) or route is not self.route:
            raise RuntimeError("client endpoint requires a trusted registered route")
        mount = getattr(request.app.state, "hypequery_client_mount_path", "")
        if type(mount) is not str:
            raise RuntimeError("client mount path must be host configured")
        paths = [
            context.path
            for context in iter_route_contexts(request.app.routes)
            if context.original_route is route and context.path is not None
        ]
        if len(paths) != 1:
            raise RuntimeError("client endpoint has ambiguous application inclusions")
        contract = self.contract(paths[0], production_profile(request), mount)["contract"]
        expected = request.headers.get("x-hypequery-client-schema")
        if expected is not None and expected != contract["endpoints"][0]["schemaHash"]:
            raise ServeError(
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
            raise ServeError(400, "VALIDATION_ERROR", "Invalid client query.") from None


class ClientEndpointRegistry:
    """Owning registry for opted-in endpoints, frozen per installed binding."""

    def __init__(self) -> None:
        self._bindings: list[ClientEndpointBinding] = []

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

    def find(self, route: object) -> ClientEndpointBinding | None:
        return next((binding for binding in self._bindings if binding.route is route), None)


def export_client_contract(
    source: ServeRouter | FastAPI,
    *,
    routers: Sequence[ServeRouter] = (),
    production: ProductionProfile | None = None,
    mount_path: str | None = None,
) -> PreparedProtocolClientContract:
    """Export only opted-in routes actually installed on this router/application.

    For a custom FastAPI host, pass its source Hypequery routers explicitly.
    Mounted child apps require their trusted external mount_path. Proxy headers
    are never consulted. create_app stores its registry and mount configuration.
    """
    from .router import ServeRouter

    registries: tuple[ClientEndpointRegistry, ...]
    if isinstance(source, ServeRouter):
        registries = (source.client_endpoints,)
        mount = "" if mount_path is None else mount_path
    else:
        owned: object = getattr(source.state, "hypequery_client_registries", None)
        if owned is None and not routers:
            raise ValueError("custom FastAPI exports require explicit Hypequery routers")
        if routers:
            registries = tuple(router.client_endpoints for router in routers)
        else:
            if type(owned) is not tuple or any(
                not isinstance(item, ClientEndpointRegistry) for item in owned
            ):
                raise ValueError("application client registries are misconfigured")
            registries = cast(tuple[ClientEndpointRegistry, ...], owned)
        configured = getattr(source.state, "hypequery_production", None)
        if production is not None and production != configured:
            raise ValueError("application export must use its installed production profile")
        production = configured
        configured_mount = getattr(source.state, "hypequery_client_mount_path", "")
        if mount_path is not None and mount_path != configured_mount:
            raise ValueError("application mount path must match its execution configuration")
        mount = configured_mount
    definitions: list[ClientEndpointDefinition] = []
    registry_datasets: dict[str, Dataset] = {}
    seen_paths: set[str] = set()
    routes = list(iter_route_contexts(source.routes))
    for route in routes:
        if (
            not isinstance(route.original_route, APIRoute)
            or route.path is None
            or "POST" not in (route.methods or set())
        ):
            continue
        binding = next(
            (
                found
                for registry in registries
                if (found := registry.find(route.original_route)) is not None
            ),
            None,
        )
        if binding is None:
            continue
        if route.path in seen_paths or client_route_conflicts(route, routes):
            raise ValueError("client export refuses ambiguous POST route paths")
        seen_paths.add(route.path)
        definitions.append(binding.definition(route.path, production))
        if binding.client.registry is not None:
            for dataset in binding.client.registry.get_all():
                previous = registry_datasets.get(dataset.name)
                if previous is not None and previous != dataset:
                    raise ValueError("client export has conflicting dataset registries")
                registry_datasets[dataset.name] = dataset
    from ..datasets import create_dataset_registry

    return export_definition_contract(
        definitions, mount_path=mount, registry=create_dataset_registry(*registry_datasets.values())
    )

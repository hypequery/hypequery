"""Client contracts for routers and FastAPI applications.

Bindings, strict validation and the export itself live in the core
(`core/client_contract.py`). This module supplies what only the FastAPI
application knows: which routers it serves and the path each route is served
at once included, mounted, or shadowed by another route.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Literal, cast

from fastapi import FastAPI, Request
from fastapi.routing import APIRoute, RouteContext, iter_route_contexts

from ..protocol import PreparedProtocolClientContract
from .core.api import Route
from .core.auth import RequestAuth
from .core.client_contract import ClientEndpointRegistry, ClientPlacement, export_placements
from .core.production import ProductionProfile
from .utils.client_route_conflicts import client_route_conflicts

if TYPE_CHECKING:
    from .router import ServeRouter


def client_registries(
    source: ServeRouter | FastAPI, routers: Sequence[ServeRouter] = ()
) -> tuple[ClientEndpointRegistry, ...]:
    """The installed binding registries an export or discovery view may project."""
    from .router import ServeRouter

    if isinstance(source, ServeRouter):
        return (source.client_endpoints,)
    if routers:
        return tuple(router.client_endpoints for router in routers)
    return _owned_registries(source)


def _owned_registries(app: FastAPI) -> tuple[ClientEndpointRegistry, ...]:
    """The registries `create_app` stored on *app*."""

    owned: object = getattr(app.state, "hypequery_client_registries", None)
    if owned is None:
        raise ValueError("custom FastAPI exports require explicit Hypequery routers")
    if type(owned) is not tuple or any(
        not isinstance(item, ClientEndpointRegistry) for item in owned
    ):
        raise ValueError("application client registries are misconfigured")
    return cast(tuple[ClientEndpointRegistry, ...], owned)


def _placements(routes: Sequence[RouteContext]) -> list[ClientPlacement]:
    """Every served POST API route, with its path and whether another route shadows it."""
    from .router import core_route_of

    placements: list[ClientPlacement] = []
    for route in routes:
        if (
            not isinstance(route.original_route, APIRoute)
            or route.path is None
            or "POST" not in (route.methods or set())
        ):
            continue
        core = core_route_of(route.original_route)
        if core is None:
            continue
        placements.append(
            ClientPlacement(
                route=core, path=route.path, ambiguous=client_route_conflicts(route, routes)
            )
        )
    return placements


class FastAPIHost:
    """Where a request's application serves the router's core routes."""

    __slots__ = ("_request", "_routes")

    def __init__(self, request: Request) -> None:
        self._request = request
        self._routes: list[RouteContext] | None = None

    def _contexts(self) -> list[RouteContext]:
        if self._routes is None:
            self._routes = list(iter_route_contexts(self._request.app.routes))
        return self._routes

    @property
    def mount_path(self) -> str:
        mount = getattr(self._request.app.state, "hypequery_client_mount_path", "")
        if type(mount) is not str:
            raise RuntimeError("client mount path must be host configured")
        return mount

    @property
    def production(self) -> ProductionProfile | None:
        configured = getattr(self._request.app.state, "hypequery_production", None)
        return configured if type(configured) is ProductionProfile else None

    def path_of(self, route: Route) -> str:
        from .router import core_route_of

        served = self._request.scope.get("route")
        if not isinstance(served, APIRoute) or core_route_of(served) is not route:
            raise RuntimeError("client endpoint requires a trusted registered route")
        paths = [
            context.path
            for context in self._contexts()
            if context.original_route is served and context.path is not None
        ]
        if len(paths) != 1:
            raise RuntimeError("client endpoint has ambiguous application inclusions")
        return paths[0]

    def registries(
        self, sources: tuple[ClientEndpointRegistry, ...]
    ) -> tuple[ClientEndpointRegistry, ...]:
        return sources or _owned_registries(self._request.app)

    def placements(
        self, registries: tuple[ClientEndpointRegistry, ...]
    ) -> Sequence[ClientPlacement]:
        return _placements(self._contexts())


def export_client_contract(
    source: ServeRouter | FastAPI,
    *,
    routers: Sequence[ServeRouter] = (),
    production: ProductionProfile | None = None,
    mount_path: str | None = None,
    view: Literal["build", "authorized"] = "build",
    auths: Mapping[ClientEndpointRegistry, RequestAuth | None] | None = None,
) -> PreparedProtocolClientContract:
    """Export only opted-in routes actually installed on this router/application.

    For a custom FastAPI host, pass its source Hypequery routers explicitly.
    Mounted child apps require their trusted external mount_path. Proxy headers
    are never consulted. create_app stores its registry and mount configuration.
    An authorized view checks each target against *auths*, the request's
    authentication by that target's own router (None when it was refused).
    """
    from .router import ServeRouter

    if view not in ("build", "authorized"):
        raise ValueError("client export view must be build or authorized")
    registries = client_registries(source, routers)
    if isinstance(source, ServeRouter):
        mount = "" if mount_path is None else mount_path
    else:
        configured = getattr(source.state, "hypequery_production", None)
        if production is not None and production != configured:
            raise ValueError("application export must use its installed production profile")
        production = configured
        configured_mount = getattr(source.state, "hypequery_client_mount_path", "")
        if mount_path is not None and mount_path != configured_mount:
            raise ValueError("application mount path must match its execution configuration")
        mount = configured_mount
    return export_placements(
        registries,
        _placements(list(iter_route_contexts(source.routes))),
        production=production,
        mount_path=mount,
        view=view,
        auths=auths,
    )

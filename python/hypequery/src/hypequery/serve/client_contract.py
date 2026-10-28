"""Client contracts for an `Api`.

Bindings, strict validation and the export itself live in the core
(`core/client_contract.py`). An API serves every route at its own path, under
its base path, so the export needs only the API: its production profile and
its client mount path are the ones the routes execute under.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

from ..protocol import PreparedProtocolClientContract
from .asgi import AsgiApp
from .core.api import Api, ApiHost
from .core.auth import RequestAuth
from .core.client_contract import ClientEndpointRegistry, export_placements
from .core.production import ProductionProfile

__all__ = ["export_client_contract"]


def export_client_contract(
    api: Api | AsgiApp,
    *,
    production: ProductionProfile | None = None,
    mount_path: str | None = None,
    view: Literal["build", "authorized"] = "build",
    auths: Mapping[ClientEndpointRegistry, RequestAuth | None] | None = None,
) -> PreparedProtocolClientContract:
    """Export only the opted-in endpoints actually installed on *api*.

    *api* is the API, or the `to_asgi_app` application serving it.
    *production* and *mount_path*, when given, must be the API's own: a
    contract never describes limits or paths its endpoints do not execute
    under. Proxy headers are never consulted. An authorized view checks each
    target against *auths*, the request's authentication by the API (None
    when it was refused).
    """

    if isinstance(api, AsgiApp):
        api = api.api
    if not isinstance(api, Api):
        raise TypeError("export_client_contract requires an Api from create_api")
    if view not in ("build", "authorized"):
        raise ValueError("client export view must be build or authorized")
    if production is not None and production != api.production:
        raise ValueError("an API's export must use its installed production profile")
    if mount_path is not None and mount_path != api.client_mount_path:
        raise ValueError("an API's mount path must match its execution configuration")
    host = ApiHost(api)
    registries = host.registries(())
    return export_placements(
        registries,
        host.placements(registries),
        production=api.production,
        mount_path=api.client_mount_path,
        view=view,
        auths=auths,
    )

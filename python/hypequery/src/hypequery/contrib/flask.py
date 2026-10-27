"""Flask extension: config, a per-process client, a tenant-bound client per request.

::

    from hypequery.contrib.flask import Hypequery

    hq = Hypequery()

    def create_app():
        app = Flask(__name__)
        app.config["HYPEQUERY_REGISTRY"] = "analytics.datasets:registry"
        hq.init_app(app)
        return app

    @hq.tenant_loader
    def current_tenant():
        return current_user.org_id if current_user.is_authenticated else None

    @bp.get("/revenue")
    def revenue():
        result = hq.client.execute("orders", {"measures": ["revenue"]})
        return {"data": list(result.data)}

Config keys: ``HYPEQUERY_URL`` (else ``CLICKHOUSE_URL`` / ``CLICKHOUSE_*``),
``HYPEQUERY_REGISTRY`` (object or import string), ``HYPEQUERY_READONLY_POLICY``,
``HYPEQUERY_TIMEZONE``, ``HYPEQUERY_MAX_CONCURRENT``.

The client is created per process on first use and closed at interpreter exit.
It is deliberately not closed in ``teardown_appcontext``, which runs after
every request. Requires ``hypequery[flask]``.
"""

from __future__ import annotations

try:
    import flask as _flask  # noqa: F401
except ModuleNotFoundError as exc:  # pragma: no cover - exercised in a subprocess
    raise ModuleNotFoundError(
        'hypequery.contrib.flask requires Flask. Install it with: pip install "hypequery[flask]"'
    ) from exc

import asyncio
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, TypeVar, cast

from flask import Flask, current_app, g
from werkzeug.utils import import_string

from ..datasets import (
    AsyncDatasetClient,
    AsyncTenantDatasetClient,
    DatasetClient,
    DatasetRegistry,
    TenantDatasetClient,
)
from ..execution import ClickHouseConnection, ReadonlyPolicy
from .utils.asgi_mount import ASGIApp
from .utils.process_clients import ClientConfig, ProcessClients
from .utils.tenant_value import TenantValue, bind_tenant_value
from .utils.wsgi_mount import mount_wsgi

TenantLoader = Callable[[], TenantValue]
_Loader = TypeVar("_Loader", bound=TenantLoader)

_EXTENSION = "hypequery"


@dataclass(frozen=True, slots=True)
class _State:
    clients: ProcessClients
    owner: Hypequery


def _config(app: Flask) -> ClientConfig:
    config = app.config
    policy = cast(ReadonlyPolicy, config.get("HYPEQUERY_READONLY_POLICY", "query"))
    url = config.get("HYPEQUERY_URL")
    if url is None:
        connection = ClickHouseConnection.from_env(readonly_policy=policy)
    elif isinstance(url, str):
        connection = ClickHouseConnection.from_url(url, readonly_policy=policy)
    else:
        raise TypeError("HYPEQUERY_URL must be a string or None")
    registry = config.get("HYPEQUERY_REGISTRY")
    if isinstance(registry, str):
        registry = import_string(registry)
    if registry is not None and not isinstance(registry, DatasetRegistry):
        raise TypeError("HYPEQUERY_REGISTRY must be a DatasetRegistry or an import string")
    return ClientConfig(
        connection=connection,
        registry=registry,
        timezone=config.get("HYPEQUERY_TIMEZONE", "UTC"),
        max_concurrent=config.get("HYPEQUERY_MAX_CONCURRENT", 4),
    )


class Hypequery:
    """The extension. Construct with an app, or later with :meth:`init_app`."""

    def __init__(self, app: Flask | None = None) -> None:
        self._tenant_loader: TenantLoader | None = None
        if app is not None:
            self.init_app(app)

    def init_app(self, app: Flask) -> None:
        """Validate configuration now, so a mistake fails at startup; connect later."""

        _config(app)
        app.extensions[_EXTENSION] = _State(ProcessClients(lambda: _config(app)), self)

    def tenant_loader(self, loader: _Loader) -> _Loader:
        """Register the function that returns the current request's tenant.

        It runs inside the request, so it may read ``flask.request``, ``g`` or
        Flask-Login's ``current_user``. Return a tenant id, a ``TenantScope``,
        or None for no tenant (tenant-keyed datasets then refuse to run).
        """

        self._tenant_loader = loader
        return loader

    def _state(self, app: Flask | None = None) -> _State:
        state = (app if app is not None else current_app).extensions.get(_EXTENSION)
        if not isinstance(state, _State) or state.owner is not self:
            raise RuntimeError("this Hypequery extension is not initialised on the current app")
        return state

    def client_for(self, app: Flask) -> DatasetClient:
        """*app*'s process-wide client, without an app context.

        For building hypequery's HTTP endpoints when the app is created. It does
        not connect until its first query, so the app starts while ClickHouse
        is down.
        """

        return self._state(app).clients.sync()

    def _tenant(self) -> TenantValue:
        return self._tenant_loader() if self._tenant_loader is not None else None

    @property
    def base_client(self) -> DatasetClient:
        """The current app's process-wide sync client, not bound to any tenant.

        It connects on its first query, not here.
        """

        return self._state().clients.sync()

    @property
    def client(self) -> DatasetClient | TenantDatasetClient:
        """The sync client bound to this request's tenant, built once per request."""

        cached: Any = g.get("_hypequery_client")
        if cached is None:
            cached = bind_tenant_value(self.base_client, self._tenant())
            g._hypequery_client = cached
        return cast(DatasetClient | TenantDatasetClient, cached)

    @property
    def async_client(self) -> AsyncDatasetClient | AsyncTenantDatasetClient:
        """The async client bound to this request's tenant, for ``async def`` views.

        Built once per request, like :attr:`client`, so the tenant loader runs
        once however many queries the view makes. The cache is keyed by event
        loop, because the async client underneath belongs to one loop.
        """

        loop = asyncio.get_running_loop()
        cached: Any = g.get("_hypequery_async_client")
        if cached is None or cached[0] is not loop:
            bound = bind_tenant_value(self._state().clients.async_client(), self._tenant())
            cached = (loop, bound)
            g._hypequery_async_client = cached
        return cast(AsyncDatasetClient | AsyncTenantDatasetClient, cached[1])

    def close(self) -> None:
        """Close the current app's clients now rather than at interpreter exit."""

        self._state().clients.close()

    def mount_serve(self, app: Flask, serve_app: ASGIApp, *, prefix: str = "/analytics") -> None:
        """Serve hypequery's HTTP endpoints (a FastAPI app) under *prefix* of *app*.

        Wraps ``app.wsgi_app``. *serve_app* keeps its own authentication: it
        reads credentials from a header, never from Flask's session cookie, and
        its ``HttpSecurity(allowed_hosts=...)`` must include the host the Flask
        app is reached on.
        """

        app.wsgi_app = mount_wsgi(app.wsgi_app, serve_app, prefix=prefix)  # type: ignore[method-assign,assignment]


__all__ = ["Hypequery", "TenantLoader"]

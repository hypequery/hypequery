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

To serve hypequery's HTTP endpoints (for ``@hypequery/react`` and
``@hypequery/mcp``) from the app itself, register :func:`blueprint` for an API
from ``hypequery.serve.create_api``::

    app.register_blueprint(blueprint(api), url_prefix="/api/analytics")

Authenticate those endpoints with the app's own login (Flask-Login's
``current_user``, or the ``session``), so a page it serves calls them with its
session cookie and no token::

    api = create_api(auth=flask_session(lambda user: Principal(subject=user.get_id())), ...)

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

from flask import Blueprint, Flask, Request, Response, current_app, g, request, session
from flask.blueprints import BlueprintSetupState
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import import_string

from ..datasets import (
    AsyncDatasetClient,
    AsyncTenantDatasetClient,
    DatasetClient,
    DatasetRegistry,
    TenantDatasetClient,
)
from ..execution import ClickHouseConnection, ReadonlyPolicy
from ..serve.client_contract import export_client_contract
from ..serve.core.api import Api
from ..serve.core.auth import Principal
from ..serve.core.body import too_large
from ..serve.core.context_auth import ContextStrategy
from ..serve.core.messages import ServeRequest, ServeResponse
from ..serve.utils.blocking import serve_blocking
from ..serve.utils.response_head import response_body
from ..serve.utils.serving_loop import RequestThread
from ..serve.utils.thread_body import thread_body
from ..serve.utils.wsgi_environ import (
    body_length,
    environ_client,
    environ_headers,
    environ_query,
    request_target_path,
)
from .utils.mounted_path import mounted_path
from .utils.process_clients import ClientConfig, ProcessClients
from .utils.tenant_value import TenantValue, bind_tenant_value

TenantLoader = Callable[[], TenantValue]
#: Maps Flask-Login's signed-in user, or the session when the app does not use
#: Flask-Login, to its principal; None refuses the request.
SessionPrincipal = Callable[[Any], Principal | None]
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

        For CLI commands, background jobs and setup code in ``create_app``. It
        does not connect until its first query, so the app starts while
        ClickHouse is down.
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


#: The methods Flask registers the rules for; once registered, the rules accept
#: every method, so the core answers any other with its own 404.
_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
#: The URL variable the catch-all rule captures the path below the prefix in.
_PATH = "hypequery_path"


def blueprint(api: Api, *, name: str = "hypequery", url_prefix: str | None = None) -> Blueprint:
    """A blueprint serving *api*, registered below any prefix.

    Every request below the prefix reaches the API, which answers it as the
    core does, its 404s and CORS preflights included. The view is sync and
    runs the core on the process's one serving loop while the request's
    thread waits (`hypequery.serve.wsgi`); ``ServeRequest.raw`` is Flask's
    `Request`. The body is read through ``request.stream``, lazily and bounded
    by the API's body policy; a body over the app's ``MAX_CONTENT_LENGTH``
    is refused as too large. Client contracts and discovery name the paths
    the request was routed under, unless the API sets ``client_mount_path``.

    When *api* serves strict client endpoints, their contract is checked now,
    so a misconfiguration fails at startup rather than on the first request.
    """

    if not isinstance(api, Api):
        raise TypeError("blueprint requires an Api from create_api")
    if api.client_endpoints.bindings:
        export_client_contract(api)

    def hypequery_api(**values: str) -> Response:
        # A prefix's own URL variables arrive here too.
        current = cast(Request, request._get_current_object())  # type: ignore[attr-defined]
        environ = current.environ
        where = mounted_path(
            current.script_root + current.path, values[_PATH], request_target_path(environ)
        )

        def build(thread: RequestThread) -> ServeRequest:
            return ServeRequest(
                method=current.method,
                path=where.path,
                query=environ_query(environ),
                headers=environ_headers(environ),
                body=thread_body(thread, _BodyStream(current).read, body_length(environ)),
                client=environ_client(environ),
                raw=current,
                run_on_request_thread=thread.call,
            )

        return _response(serve_blocking(api, build, mounted_at=where.mounted_at))

    served = Blueprint(name, __name__, url_prefix=url_prefix)
    served.add_url_rule("/", "api", hypequery_api, defaults={_PATH: ""}, methods=_METHODS)
    served.add_url_rule(f"/<path:{_PATH}>", "api", hypequery_api, methods=_METHODS)
    served.record(_accept_every_method)
    return served


def _accept_every_method(state: BlueprintSetupState) -> None:
    """Let the blueprint's rules match any method, as the other adapters do.

    Flask registers a rule for a fixed list of methods and answers any other
    with its own HTML 405; the core answers an unknown method with its 404.
    Werkzeug reads a rule's methods when matching, and None means any.
    """

    endpoint = f"{state.name_prefix}.{state.name}.api".lstrip(".")
    for rule in state.app.url_map.iter_rules(endpoint):
        rule.methods = None


class _BodyStream:
    """The request body, as Flask's own form parsing reads it.

    A ``before_request`` hook that called ``request.get_data()`` or
    ``get_json()`` has already drained ``request.stream`` and cached the
    bytes, so those are read instead. The stream is resolved on the first
    read: resolving it refuses a body over ``MAX_CONTENT_LENGTH``.
    """

    __slots__ = ("_request", "_stream")

    def __init__(self, current: Request) -> None:
        self._request = current
        self._stream: Any = None

    def read(self, size: int) -> bytes:
        try:
            if self._stream is None:
                self._stream = self._request._get_stream_for_parsing()
            data: bytes = self._stream.read(size)
        except RequestEntityTooLarge:
            raise too_large() from None
        return data


def _response(response: ServeResponse) -> Response:
    reply = Response(response_body(response), status=response.status)
    if "content-type" not in response.headers:
        del reply.headers["Content-Type"]
    for name, value in response.headers.items():
        reply.headers[name] = value
    return reply


def flask_session(to_principal: SessionPrincipal, *, same_origin: bool = True) -> ContextStrategy:
    """A `from_context` strategy reading the app's own login, for `create_api(auth=...)`.

    When Flask-Login is set up on the app, *to_principal* receives
    ``current_user`` and runs only for a signed-in user; an anonymous one is
    answered 401. Otherwise it receives ``session`` and returns None when
    nobody is signed in. It runs on the request's own thread, inside the
    request context, as the app's views do, so a user loader's thread-local
    database session is the request's. *same_origin* is `from_context`'s
    check. Use it with `blueprint`.
    """

    if not callable(to_principal):
        raise TypeError("flask_session requires a to_principal callable")
    return ContextStrategy(_FlaskSession(to_principal), same_origin)


class _FlaskSession:
    __slots__ = ("_to_principal",)

    def __init__(self, to_principal: SessionPrincipal) -> None:
        self._to_principal = to_principal

    def __call__(self, served: ServeRequest) -> Principal | None:
        if not isinstance(served.raw, Request):
            raise TypeError("flask_session reads requests served by hypequery.contrib.flask")
        # Flask-Login's init_app sets `login_manager` on the app.
        if getattr(current_app, "login_manager", None) is not None:
            from flask_login import current_user

            user = current_user._get_current_object()
            return self._to_principal(user) if user.is_authenticated else None
        return self._to_principal(session._get_current_object())  # type: ignore[attr-defined]


__all__ = ["Hypequery", "SessionPrincipal", "TenantLoader", "blueprint", "flask_session"]

"""Local development runner: loopback by default, loud about anything else.

``run_dev`` serves an API built with ``create_api`` for local work. It listens
on ``127.0.0.1:8000`` unless told otherwise and warns when bound beyond
loopback. It is not hardened for a network: use ``start_server`` behind a
reverse proxy for anything other people can reach.

From a shell, ``python -m hypequery.serve.dev app:app`` does the same. Serving
needs uvicorn, from the ``server`` extra.
"""

from __future__ import annotations

import json
import os
import sys
import warnings

from ...execution.utils.driver_loggers import apply_driver_log_levels, driver_log_levels
from ..asgi import AsgiApp, to_asgi_app
from ..core.api import Api
from ..utils.bind_address import is_loopback
from ..utils.uvicorn_server import import_uvicorn

_RELOAD_TARGET = "HYPEQUERY_DEV_RELOAD_TARGET"


class ExternalBindWarning(UserWarning):
    """The development server is reachable from beyond this machine."""


def _check_app(app: object) -> AsgiApp:
    """*app* as the ASGI application to serve, refusing what run_dev may not serve."""

    if isinstance(app, Api):
        app = to_asgi_app(app)
    if not isinstance(app, AsgiApp):
        raise TypeError(
            "run_dev requires an Api, its to_asgi_app application, "
            "or an import string 'module:attribute'"
        )
    if app.api.production is not None:
        raise ValueError("this app was created with a ProductionProfile; run it with start_server")
    return app


def run_dev(
    app: Api | AsgiApp | str,
    *,
    host: str = "127.0.0.1",
    port: int = 8000,
    reload: bool = False,
) -> None:
    """Serve *app* for local development.

    *app* is an API, its `to_asgi_app` application, or an import string such
    as ``"app:app"`` naming either, resolved from the working directory.
    ``reload=True`` restarts on file changes and needs an import string,
    because a new process must import the app again.
    """

    if type(host) is not str:
        raise TypeError("host must be a string")
    if type(port) is not int or not 0 < port < 65536:
        raise ValueError("port must be an integer in [1, 65535]")
    if type(reload) is not bool:
        raise TypeError("reload must be a boolean")
    if not is_loopback(host):
        warnings.warn(
            f"the hypequery development server is listening on {host}:{port}, so other "
            "machines on the network can reach it. The development runner is not "
            "hardened for that: bind to 127.0.0.1, or use start_server behind a proxy.",
            ExternalBindWarning,
            stacklevel=2,
        )
    target: AsgiApp | str = app if isinstance(app, str) else _check_app(app)
    if not isinstance(app, str) and reload:
        raise ValueError("reload=True requires an import string such as 'app:app'")
    # Lazy: importing this module never starts or imports a server.
    uvicorn = import_uvicorn()

    saved_path = list(sys.path)
    saved_target = os.environ.get(_RELOAD_TARGET)
    try:
        if isinstance(app, str):
            # Fail fast in this process, then re-check in every reload worker:
            # Uvicorn imports the app itself there, so it goes through
            # ``_reload_app`` rather than the user's import string.
            target = _import_app(app, os.getcwd())
            if reload:
                os.environ[_RELOAD_TARGET] = json.dumps([os.getcwd(), app, driver_log_levels()])
                target = f"{__name__}:_reload_app"
        uvicorn.run(
            target,
            host=host,
            port=port,
            reload=reload,
            factory=reload,
            workers=1,
            proxy_headers=False,
            forwarded_allow_ips="",
            server_header=False,
            ws="none",
        )
    finally:
        # Leave the caller's import path and environment as they were.
        sys.path[:] = saved_path
        if saved_target is None:
            os.environ.pop(_RELOAD_TARGET, None)
        else:
            os.environ[_RELOAD_TARGET] = saved_target


def _import_app(spec: str, app_dir: str, *, redact_errors: bool = False) -> AsgiApp:
    """Import *spec* from *app_dir*, and refuse what run_dev may not serve.

    *app_dir* stays on the path while the app is served, for its lazy imports;
    ``run_dev`` restores the caller's path when the server stops.
    """

    from uvicorn.importer import import_from_string

    if app_dir not in sys.path:
        sys.path.insert(0, app_dir)
    try:
        app = import_from_string(spec)
    except Exception:
        if not redact_errors:
            raise
        # Reload workers run outside the CLI error handler. User exceptions
        # can contain credentials; suppress their message and traceback chain.
        raise RuntimeError(
            "App reload failed; check its code, dependencies and environment."
        ) from None
    return _check_app(app)


def _reload_app() -> AsgiApp:
    """Uvicorn factory for reload workers: import and check the target app."""

    app_dir, spec, *rest = json.loads(os.environ[_RELOAD_TARGET])
    # Before the import: a connection made while importing may already warn.
    apply_driver_log_levels(rest[0] if rest else None)
    return _import_app(spec, app_dir, redact_errors=True)


__all__ = ["ExternalBindWarning", "run_dev", "serve_dev"]


# Canonical cross-language name; retain run_dev for existing callers.
serve_dev = run_dev

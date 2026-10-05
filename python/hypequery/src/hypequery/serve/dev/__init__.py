"""Local development runner: loopback by default, loud about anything else.

``run_dev`` serves an app built with ``create_app`` for local work. It listens
on ``127.0.0.1:8000`` unless told otherwise and warns when bound beyond
loopback. It is not hardened for a network: use ``run_production`` behind a
reverse proxy for anything other people can reach.

From a shell, ``python -m hypequery.serve.dev app:app`` does the same.
"""

from __future__ import annotations

import json
import os
import sys
import warnings
from typing import cast

from fastapi import FastAPI

from ..utils.bind_address import is_loopback

_RELOAD_TARGET = "HYPEQUERY_DEV_RELOAD_TARGET"


class ExternalBindWarning(UserWarning):
    """The development server is reachable from beyond this machine."""


def _check_app(app: object) -> None:
    if not isinstance(app, FastAPI):
        raise TypeError("run_dev requires a FastAPI app or an import string 'module:attribute'")
    if getattr(app.state, "hypequery_production", None) is not None:
        raise ValueError(
            "this app was created with a ProductionProfile; run it with run_production"
        )


def run_dev(
    app: FastAPI | str,
    *,
    host: str = "127.0.0.1",
    port: int = 8000,
    reload: bool = False,
) -> None:
    """Serve *app* for local development.

    *app* is a FastAPI app or an import string such as ``"app:app"``, resolved
    from the working directory. ``reload=True`` restarts on file changes and
    needs an import string, because a new process must import the app again.
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
            "hardened for that: bind to 127.0.0.1, or use run_production behind a proxy.",
            ExternalBindWarning,
            stacklevel=2,
        )
    if not isinstance(app, str):
        _check_app(app)
        if reload:
            raise ValueError("reload=True requires an import string such as 'app:app'")
    # Lazy: importing this module never starts or imports a server.
    import uvicorn

    saved_path = list(sys.path)
    saved_target = os.environ.get(_RELOAD_TARGET)
    target: FastAPI | str = app
    try:
        if isinstance(app, str):
            # Fail fast in this process, then re-check in every reload worker:
            # Uvicorn imports the app itself there, so it goes through
            # ``_reload_app`` rather than the user's import string.
            target = _import_app(app, os.getcwd())
            if reload:
                os.environ[_RELOAD_TARGET] = json.dumps([os.getcwd(), app])
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


def _import_app(spec: str, app_dir: str) -> FastAPI:
    """Import *spec* from *app_dir*, and refuse what run_dev may not serve.

    *app_dir* stays on the path while the app is served, for its lazy imports;
    ``run_dev`` restores the caller's path when the server stops.
    """

    from uvicorn.importer import import_from_string

    if app_dir not in sys.path:
        sys.path.insert(0, app_dir)
    app = import_from_string(spec)
    _check_app(app)
    return cast(FastAPI, app)


def _reload_app() -> FastAPI:
    """Uvicorn factory for reload workers: import and check the target app."""

    app_dir, spec = json.loads(os.environ[_RELOAD_TARGET])
    return _import_app(spec, app_dir)


__all__ = ["ExternalBindWarning", "run_dev"]

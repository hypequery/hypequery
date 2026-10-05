"""Local development runner: loopback by default, loud about anything else.

``run_dev`` serves an app built with ``create_app`` for local work. It listens
on ``127.0.0.1:8000`` unless told otherwise and warns when bound beyond
loopback. It is not hardened for a network: use ``run_production`` behind a
reverse proxy for anything other people can reach.

From a shell, ``python -m hypequery.serve.dev app:app`` does the same.
"""

from __future__ import annotations

import os
import sys
import warnings

from fastapi import FastAPI

from ..utils.bind_address import is_loopback


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
    # Lazy: importing this module never starts or imports a server.
    import uvicorn

    target: FastAPI | str = app
    app_dir: str | None = None
    if isinstance(app, str):
        app_dir = os.getcwd()
        if not reload:
            if app_dir not in sys.path:
                sys.path.insert(0, app_dir)
            from uvicorn.importer import import_from_string

            target = import_from_string(app)
    elif reload:
        raise ValueError("reload=True requires an import string such as 'app:app'")
    if not isinstance(target, str):
        _check_app(target)
    uvicorn.run(
        target,
        host=host,
        port=port,
        reload=reload,
        app_dir=app_dir,
        workers=1,
        proxy_headers=False,
        forwarded_allow_ips="",
        server_header=False,
        ws="none",
    )


__all__ = ["ExternalBindWarning", "run_dev"]

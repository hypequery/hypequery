"""The supported uvicorn runner for a production profile (the `server` extra)."""

from __future__ import annotations

from .asgi import AsgiApp, to_asgi_app
from .core.api import Api
from .core.production import ProductionProfile
from .utils.uvicorn_server import import_uvicorn


def start_server(app: Api | AsgiApp) -> None:
    """Serve an API created with ``create_api(..., production=profile)``.

    *app* is the API, or its `to_asgi_app` application when it has a
    lifespan. One worker per process: a process manager may run multiple
    instances, each with its own admission ceiling. TLS belongs to the trusted
    reverse proxy.
    """

    asgi = to_asgi_app(app) if isinstance(app, Api) else app
    if not isinstance(asgi, AsgiApp):
        raise TypeError("start_server requires an Api or its to_asgi_app application")
    profile = asgi.api.production
    if type(profile) is not ProductionProfile:
        raise ValueError("start_server requires an API created with a ProductionProfile")
    # Lazy: importing definitions or building an API never starts a server.
    uvicorn = import_uvicorn()
    uvicorn.run(
        asgi,
        host=profile.host,
        port=profile.port,
        workers=1,
        reload=False,
        proxy_headers=False,
        forwarded_allow_ips="",
        access_log=False,
        server_header=False,
        timeout_keep_alive=5,
        timeout_graceful_shutdown=profile.timeout_seconds + 5,
        backlog=128,
        ws="none",
        lifespan="on",
    )


#: The Python spelling of `start_server`, which matches TypeScript's `startServer`.
run_production = start_server

__all__ = ["ProductionProfile", "run_production", "start_server"]

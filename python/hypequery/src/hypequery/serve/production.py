"""The supported Uvicorn runner for a production profile."""

from __future__ import annotations

from fastapi import FastAPI

from .core.production import ProductionProfile


def start_server(app: FastAPI) -> None:
    """Run an app created with ``create_app(..., production=profile)``.

    One worker per process: a process manager may run multiple instances, each
    with its own admission ceiling. TLS belongs to the trusted reverse proxy.
    """
    profile = getattr(app.state, "hypequery_production", None)
    if type(profile) is not ProductionProfile:
        raise ValueError("start_server requires an application with a ProductionProfile")
    if app.debug or app.docs_url or app.redoc_url or app.openapi_url:
        raise ValueError("production disables debug and documentation routes")
    # Lazy: importing definitions or building an app never starts a server.
    import uvicorn

    uvicorn.run(
        app,
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
    )


#: The Python spelling of `start_server`, which matches TypeScript's `startServer`.
run_production = start_server

__all__ = ["ProductionProfile", "run_production", "start_server"]

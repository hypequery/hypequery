"""Validated production process configuration and the supported Uvicorn runner."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass

from fastapi import FastAPI

from ..datasets.planner.settings import QuerySettings, query_settings


@dataclass(frozen=True, slots=True)
class ProductionProfile:
    """Per-process ceilings. Cookie authentication is deliberately unsupported.

    ``max_result_rows`` includes the one-row pagination probe. Bind beyond
    loopback only by explicitly setting ``allow_external_bind``.
    """

    host: str = "127.0.0.1"
    port: int = 8000
    allow_external_bind: bool = False
    debug: bool = False
    reload: bool = False
    cookie_auth: bool = False
    max_concurrency: int = 32
    timeout_seconds: int = 30
    max_result_rows: int = 10_001
    max_result_bytes: int = 8 << 20
    max_threads: int = 4

    def __post_init__(self) -> None:
        for name in ("allow_external_bind", "debug", "reload", "cookie_auth"):
            if type(getattr(self, name)) is not bool:
                raise TypeError(f"{name} must be a boolean")
        if self.debug or self.reload:
            raise ValueError("production disables debug and reload")
        if self.cookie_auth:
            raise ValueError(
                "production supports header credentials only; cookie auth is unsupported"
            )
        if type(self.host) is not str:
            raise TypeError("host must be an IP address string")
        address = ipaddress.ip_address(self.host)
        if not address.is_loopback and not self.allow_external_bind:
            raise ValueError("external binding requires allow_external_bind=True")
        for name, lower, upper in (
            ("port", 1, 65535),
            ("max_concurrency", 1, 1024),
            ("timeout_seconds", 1, 3600),
            ("max_result_rows", 2, 10_000_000),
            ("max_result_bytes", 1024, 1 << 30),
            ("max_threads", 1, 64),
        ):
            value = getattr(self, name)
            if type(value) is not int or not lower <= value <= upper:
                raise ValueError(f"{name} must be an integer in [{lower}, {upper}]")

    def query_settings(self) -> QuerySettings:
        """The same ceilings applied to ClickHouse, before rows are materialized."""
        return query_settings(
            max_execution_time=self.timeout_seconds,
            max_result_rows=self.max_result_rows,
            max_result_bytes=self.max_result_bytes,
            max_threads=self.max_threads,
        )


def run_production(app: FastAPI) -> None:
    """Run an app created with ``create_app(..., production=profile)``.

    One worker per process: a process manager may run multiple instances, each
    with its own admission ceiling. TLS belongs to the trusted reverse proxy.
    """
    profile = getattr(app.state, "hypequery_production", None)
    if type(profile) is not ProductionProfile:
        raise ValueError("run_production requires an application with a ProductionProfile")
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


# Cross-language transport name; production profile checks remain mandatory.
start_server = run_production

"""Application factory with documentation closed by default."""

from __future__ import annotations

import ipaddress

from fastapi import FastAPI

from .production import ProductionProfile
from .production_limits import ProductionLimitsMiddleware
from .router import ServeRouter
from .security import HttpSecurity, install_http_security


def create_app(
    router: ServeRouter,
    *,
    security: HttpSecurity,
    development_docs: bool = False,
    production: ProductionProfile | None = None,
) -> FastAPI:
    """Build the serving app. Public docs require explicit development opt-in.

    Supply a production profile to enforce process budgets. When embedding in
    an existing app, the host owns its docs and process configuration.
    """

    if type(development_docs) is not bool:
        raise TypeError("development_docs must be a boolean")
    if type(security) is not HttpSecurity:
        raise TypeError("security must be an HttpSecurity")
    if production is not None:
        if type(production) is not ProductionProfile:
            raise TypeError("production must be a ProductionProfile")
        if development_docs:
            raise ValueError("production disables development documentation")
        if router.credential_header == "cookie":
            raise ValueError("production supports header credentials only, not cookies")
        if any(
            ipaddress.ip_network(proxy, strict=False).prefixlen == 0
            for proxy in security.trusted_proxies
        ):
            raise ValueError("production cannot trust every proxy address")
    app = FastAPI(
        docs_url="/docs" if development_docs else None,
        redoc_url="/redoc" if development_docs else None,
        openapi_url="/openapi.json" if development_docs else None,
    )
    app.include_router(router)
    if production is not None:
        app.state.hypequery_production = production
        app.add_middleware(ProductionLimitsMiddleware, profile=production)
    install_http_security(app, security)
    return app

"""Application factory with documentation closed by default."""

from __future__ import annotations

from fastapi import FastAPI

from .router import ServeRouter
from .security import HttpSecurity, install_http_security


def create_app(
    router: ServeRouter,
    *,
    security: HttpSecurity,
    development_docs: bool = False,
) -> FastAPI:
    """Build the serving app. Public docs require explicit development opt-in.

    This controls documentation only; ASGI process configuration belongs to
    PYD-06. When embedding in an existing app, the host owns its docs policy.
    """

    if type(development_docs) is not bool:
        raise TypeError("development_docs must be a boolean")
    app = FastAPI(
        docs_url="/docs" if development_docs else None,
        redoc_url="/redoc" if development_docs else None,
        openapi_url="/openapi.json" if development_docs else None,
    )
    app.include_router(router)
    install_http_security(app, security)
    return app

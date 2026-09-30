"""FastAPI serving layer for Hypequery datasets.

Requires the ``fastapi`` extra. This module fails loudly and early rather than
letting a missing optional dependency surface as a confusing error deeper in a
request path.
"""

from __future__ import annotations

try:
    import fastapi as _fastapi  # noqa: F401
except ModuleNotFoundError as exc:  # pragma: no cover - exercised in a subprocess
    raise ModuleNotFoundError(
        "hypequery.serve requires the 'fastapi' extra. "
        'Install it with: pip install "hypequery[fastapi]"'
    ) from exc

from .auth import (
    MAX_CREDENTIAL_LENGTH,
    Authenticator,
    Credential,
    CredentialKind,
    CredentialTransport,
    InvalidCredential,
    Principal,
    RequestAuth,
    TenantResolver,
    api_key,
    bearer_token,
    default_tenant_resolver,
)
from .router import ServeRouter, create_router

__all__ = [
    "MAX_CREDENTIAL_LENGTH",
    "Authenticator",
    "Credential",
    "CredentialKind",
    "CredentialTransport",
    "InvalidCredential",
    "Principal",
    "RequestAuth",
    "ServeRouter",
    "TenantResolver",
    "api_key",
    "bearer_token",
    "create_router",
    "default_tenant_resolver",
]

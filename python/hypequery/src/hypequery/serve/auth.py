"""Authentication for served endpoints: credentials, principals, and failures.

Defined in the framework-neutral core (`core/auth.py`, `core/authentication.py`)
and re-exported here.
"""

from __future__ import annotations

from .core.auth import (
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
    misconfigured,
    unauthenticated,
    unavailable,
)

__all__ = [
    "MAX_CREDENTIAL_LENGTH",
    "Authenticator",
    "Credential",
    "CredentialKind",
    "CredentialTransport",
    "InvalidCredential",
    "Principal",
    "RequestAuth",
    "TenantResolver",
    "api_key",
    "bearer_token",
    "default_tenant_resolver",
    "misconfigured",
    "unauthenticated",
    "unavailable",
]

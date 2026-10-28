"""Authentication for served endpoints: credentials, principals, and failures.

Defined in the framework-neutral core (`core/auth.py`, `core/authentication.py`,
`core/context_auth.py`, `core/jwt_auth.py`) and re-exported here.
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
from .core.context_auth import ContextExtractor, ContextStrategy, from_context
from .core.jwt_auth import (
    AnalyticsTokenIssuer,
    ClaimsMapper,
    JwtStrategy,
    analytics_token_issuer,
    jwt_strategy,
)

__all__ = [
    "MAX_CREDENTIAL_LENGTH",
    "AnalyticsTokenIssuer",
    "Authenticator",
    "ClaimsMapper",
    "ContextExtractor",
    "ContextStrategy",
    "Credential",
    "CredentialKind",
    "CredentialTransport",
    "InvalidCredential",
    "JwtStrategy",
    "Principal",
    "RequestAuth",
    "TenantResolver",
    "analytics_token_issuer",
    "api_key",
    "bearer_token",
    "default_tenant_resolver",
    "from_context",
    "jwt_strategy",
    "misconfigured",
    "unauthenticated",
    "unavailable",
]

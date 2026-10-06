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

from .application import create_app
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
from .body_policy import DEFAULT_MAX_BODY_BYTES
from .dev import ExternalBindWarning, run_dev, serve_dev
from .discovery import add_discovery_endpoint
from .endpoints import DiagnosticAccess, add_dataset_endpoint, add_metric_endpoint
from .errors import ServeError, ServeErrorType
from .events import QueryEvents
from .policy import EndpointPolicy
from .production import ProductionProfile, run_production
from .rate_limit import MemoryRateLimitStore, RateLimit, RateLimitKey, RateLimitStore
from .request_ids import MAX_CORRELATION_ID_BYTES, request_id, validate_correlation_id
from .router import ServeRouter, create_router
from .security import CorsPolicy, HttpSecurity, install_http_security

__all__ = [
    "DEFAULT_MAX_BODY_BYTES",
    "MAX_CORRELATION_ID_BYTES",
    "MAX_CREDENTIAL_LENGTH",
    "Authenticator",
    "CorsPolicy",
    "Credential",
    "CredentialKind",
    "CredentialTransport",
    "DiagnosticAccess",
    "EndpointPolicy",
    "ExternalBindWarning",
    "HttpSecurity",
    "InvalidCredential",
    "MemoryRateLimitStore",
    "Principal",
    "ProductionProfile",
    "QueryEvents",
    "RateLimit",
    "RateLimitKey",
    "RateLimitStore",
    "RequestAuth",
    "ServeError",
    "ServeErrorType",
    "ServeRouter",
    "TenantResolver",
    "add_dataset_endpoint",
    "add_discovery_endpoint",
    "add_metric_endpoint",
    "api_key",
    "bearer_token",
    "create_app",
    "create_router",
    "default_tenant_resolver",
    "install_http_security",
    "request_id",
    "run_dev",
    "run_production",
    "serve_dev",
    "validate_correlation_id",
]

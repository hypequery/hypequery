"""Serve hypequery datasets over HTTP, from any Python framework.

`create_api(...)` builds a framework-neutral `Api` whose `handle` serves one
`ServeRequest`. Adapters put it on a transport: `to_asgi_app(api)` for uvicorn
and any ASGI framework, `start_server(api)` for a standalone production
process. Nothing here needs a web framework; running a server needs uvicorn,
from the ``server`` extra.
"""

from __future__ import annotations

from .api import create_api
from .asgi import AsgiApp, to_asgi_app
from .auth import (
    MAX_CREDENTIAL_LENGTH,
    AnalyticsTokenIssuer,
    Authenticator,
    ClaimsMapper,
    Credential,
    CredentialKind,
    CredentialTransport,
    InvalidCredential,
    JwtStrategy,
    Principal,
    RequestAuth,
    TenantResolver,
    analytics_token_issuer,
    api_key,
    bearer_token,
    default_tenant_resolver,
    jwt_strategy,
)
from .client_contract import export_client_contract
from .client_discovery import add_client_contract_endpoint
from .core.api import Api, Call, Route
from .core.body import DEFAULT_MAX_BODY_BYTES
from .core.messages import Headers, QueryParams, ServeRequest, ServeResponse
from .core.openapi import openapi_document
from .core.openapi_info import OpenApiInfo
from .dev import ExternalBindWarning, run_dev, serve_dev
from .discovery import add_discovery_endpoint
from .endpoints import (
    DatasetEndpoint,
    DiagnosticAccess,
    add_dataset_endpoint,
    add_metric_endpoint,
    create_dataset_endpoint,
    create_metric_endpoint,
)
from .errors import ServeError, ServeErrorType
from .events import QueryEvents
from .policy import EndpointPolicy
from .production import ProductionProfile, run_production, start_server
from .rate_limit import MemoryRateLimitStore, RateLimit, RateLimitKey, RateLimitStore
from .request_ids import MAX_CORRELATION_ID_BYTES, sanitize_correlation_id
from .security import CorsPolicy, HttpSecurity

__all__ = [
    "DEFAULT_MAX_BODY_BYTES",
    "MAX_CORRELATION_ID_BYTES",
    "MAX_CREDENTIAL_LENGTH",
    "AnalyticsTokenIssuer",
    "Api",
    "AsgiApp",
    "Authenticator",
    "Call",
    "ClaimsMapper",
    "CorsPolicy",
    "Credential",
    "CredentialKind",
    "CredentialTransport",
    "DatasetEndpoint",
    "DiagnosticAccess",
    "EndpointPolicy",
    "ExternalBindWarning",
    "Headers",
    "HttpSecurity",
    "InvalidCredential",
    "JwtStrategy",
    "MemoryRateLimitStore",
    "OpenApiInfo",
    "Principal",
    "ProductionProfile",
    "QueryEvents",
    "QueryParams",
    "RateLimit",
    "RateLimitKey",
    "RateLimitStore",
    "RequestAuth",
    "Route",
    "ServeError",
    "ServeErrorType",
    "ServeRequest",
    "ServeResponse",
    "TenantResolver",
    "add_client_contract_endpoint",
    "add_dataset_endpoint",
    "add_discovery_endpoint",
    "add_metric_endpoint",
    "analytics_token_issuer",
    "api_key",
    "bearer_token",
    "create_api",
    "create_dataset_endpoint",
    "create_metric_endpoint",
    "default_tenant_resolver",
    "export_client_contract",
    "jwt_strategy",
    "openapi_document",
    "run_dev",
    "run_production",
    "sanitize_correlation_id",
    "serve_dev",
    "start_server",
    "to_asgi_app",
]

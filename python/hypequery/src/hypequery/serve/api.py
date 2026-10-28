"""`create_api`: TypeScript's `createAPI`, returning the framework-neutral `Api`.

The API is transport-agnostic. Serve it with an adapter: `to_asgi_app(api)`
for uvicorn and any ASGI framework, or `start_server(api)` for a standalone
production process. Calling `await api.handle(request)` serves one
`ServeRequest` with no server at all.
"""

from __future__ import annotations

import ipaddress
from collections.abc import Mapping, Sequence

from ..datasets import Dataset
from ..datasets.client import AsyncDatasetClient, DatasetClient
from ..datasets.registry import create_dataset_registry
from ..datasets.validation import validate_identifier
from .core.api import Api
from .core.auth import (
    Authenticator,
    CredentialTransport,
    TenantResolver,
    bearer_token,
    default_tenant_resolver,
)
from .core.authentication import Authentication
from .core.body import DEFAULT_MAX_BODY_BYTES
from .core.discovery import add_discovery_route
from .core.openapi import add_docs_routes
from .core.openapi_info import OpenApiInfo
from .core.policy import DEFAULT_ENDPOINT_POLICY, EndpointPolicy
from .core.production import ProductionProfile
from .core.rate_limit import RateLimit
from .core.security import HttpSecurity
from .endpoints import DatasetEndpoint, create_dataset_endpoint
from .events import QueryEvents

__all__ = ["create_api"]


def create_api(
    *,
    auth: Authenticator,
    credentials: CredentialTransport | None = None,
    tenant: TenantResolver | None = None,
    security: HttpSecurity | None = None,
    production: ProductionProfile | None = None,
    client: DatasetClient | AsyncDatasetClient | None = None,
    datasets: Mapping[str, Dataset | DatasetEndpoint] | None = None,
    metrics: Mapping[str, DatasetEndpoint] | None = None,
    discovery: bool | EndpointPolicy = True,
    limits: Sequence[RateLimit] = (),
    events: QueryEvents | None = None,
    base_path: str = "",
    max_body_bytes: int = DEFAULT_MAX_BODY_BYTES,
    development_docs: bool = False,
    openapi: OpenApiInfo | None = None,
    client_mount_path: str = "",
) -> Api:
    """Create the API hypequery endpoints are served from.

    *auth* receives the opaque credential and returns the `Principal`. It
    rejects a credential by returning None or raising `InvalidCredential`; any
    other exception is treated as authentication being unavailable. It may be
    sync or async. *credentials* is where the credential is read from,
    `bearer_token()` by default. *tenant* maps a principal to its tenant
    capability; by default a principal's `tenant_id` scopes the request and a
    principal without one is tenant-free.

    *security* is the HTTP profile: trusted hosts, proxies and CORS.
    *production* adds process budgets and is refused with development docs, a
    cookie credential, or a proxy list that trusts every address.

    *datasets* serves `POST /datasets/<name>/query` for each entry, and
    *metrics* serves `POST /metrics/<name>`. A dataset entry is a `Dataset`,
    queried through *client* under the default policy, or an endpoint from
    `create_dataset_endpoint`; a metric entry comes from
    `create_metric_endpoint`. With either, *discovery* also serves
    `GET /discovery` over their datasets, authenticated by default; pass an
    `EndpointPolicy` to change who may read it, or False to leave it out.
    `add_dataset_endpoint` and the other `add_*` functions add endpoints at
    any other path.

    *limits* apply to every route, before each route's own. *events* is the
    query-event sink for every endpoint that has none of its own. Every route
    is served under *base_path*. *max_body_bytes* bounds every request body,
    1 MiB by default. *development_docs* serves `GET /openapi.json` and
    `GET /docs`, described by *openapi*. *client_mount_path* is where the
    application is mounted, for the paths a client contract names.
    """

    if not callable(auth):
        raise TypeError("create_api requires an auth callable")
    if tenant is not None and not callable(tenant):
        raise TypeError("tenant must be a callable resolver")
    if credentials is not None and type(credentials) is not CredentialTransport:
        raise TypeError("credentials must come from bearer_token() or api_key()")
    if type(development_docs) is not bool:
        raise TypeError("development_docs must be a boolean")
    if events is not None and type(events) is not QueryEvents:
        raise TypeError("events must be QueryEvents")
    transport = credentials or bearer_token()
    if production is not None:
        _check_production(production, security, transport, development_docs)
    api = Api(
        authentication=Authentication(auth, transport, tenant or default_tenant_resolver),
        max_body_bytes=max_body_bytes,
        client_mount_path=client_mount_path,
        security=security,
        production=production,
        base_path=base_path,
        limits=limits,
        events=events,
        openapi=openapi,
    )
    served = _semantic_endpoints(api, client, datasets or {}, metrics or {})
    if served and discovery is not False:
        policy = DEFAULT_ENDPOINT_POLICY if discovery is True else discovery
        if type(policy) is not EndpointPolicy:
            raise TypeError("discovery must be a boolean or an EndpointPolicy")
        unique = {id(dataset): dataset for dataset in served}
        add_discovery_route(
            api,
            "/discovery",
            registry=create_dataset_registry(*unique.values()),
            policy=policy,
            tags=("discovery",),
        )
    if development_docs:
        add_docs_routes(api)
    return api


def _check_production(
    production: ProductionProfile,
    security: HttpSecurity | None,
    credentials: CredentialTransport,
    development_docs: bool,
) -> None:
    if type(production) is not ProductionProfile:
        raise TypeError("production must be a ProductionProfile")
    if security is None:
        raise ValueError("production requires an HttpSecurity naming its trusted hosts")
    if development_docs:
        raise ValueError("production disables development documentation")
    if credentials.header == "cookie":
        raise ValueError("production supports header credentials only, not cookies")
    if any(
        ipaddress.ip_network(proxy, strict=False).prefixlen == 0
        for proxy in security.trusted_proxies
    ):
        raise ValueError("production cannot trust every proxy address")


def _semantic_endpoints(
    api: Api,
    client: DatasetClient | AsyncDatasetClient | None,
    datasets: Mapping[str, Dataset | DatasetEndpoint],
    metrics: Mapping[str, DatasetEndpoint],
) -> list[Dataset]:
    """Install the declared dataset and metric endpoints; return their datasets."""

    served: list[Dataset] = []
    for name, entry in datasets.items():
        endpoint = entry
        if isinstance(entry, Dataset):
            if client is None:
                raise ValueError("create_api requires a client to serve a Dataset")
            endpoint = create_dataset_endpoint(dataset=entry, client=client)
        if not isinstance(endpoint, DatasetEndpoint) or endpoint.measure is not None:
            raise TypeError("each datasets entry is a Dataset or a dataset endpoint")
        endpoint.install(api, f"/datasets/{validate_identifier(name)}/query")
        served.append(endpoint.dataset)
    for name, metric in metrics.items():
        if not isinstance(metric, DatasetEndpoint) or metric.measure is None:
            raise TypeError("each metrics entry comes from create_metric_endpoint")
        metric.install(api, f"/metrics/{validate_identifier(name)}")
        served.append(metric.dataset)
    return served

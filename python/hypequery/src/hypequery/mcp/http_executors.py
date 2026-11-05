"""Executor factories for `create_mcp_asgi_app`: in this process, or over HTTPS.

SDK-free, so the wiring is testable without the `mcp` extra.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping

from ..serve import Api
from .backends import ApiContractBackend, BackendHeaders, HttpContractBackend
from .budgets import CatalogBudget, ExecutionBudget, QueryLimits
from .executor import ClientContractExecutor
from .http_auth import ApiAuthenticator, McpAuthenticator, McpPrincipal
from .utils.oauth import ProtectedResource


class ApiExecutorFactory:
    """Executors over *api* in this process.

    With an `ApiAuthenticator`, each principal's own credential is forwarded
    on every discovery and query, so the API authorizes and scopes each call
    as it does over REST. Otherwise the fixed *headers* are used, one backend
    principal for every caller (a static MCP key).
    """

    __slots__ = ("_api", "_catalog_budget", "_execution_budget", "_headers", "_query_limits")

    def __init__(
        self,
        api: Api,
        *,
        headers: BackendHeaders | None = None,
        execution_budget: ExecutionBudget | None = None,
        query_limits: QueryLimits | None = None,
        catalog_budget: CatalogBudget | None = None,
    ) -> None:
        if not isinstance(api, Api):
            raise TypeError("ApiExecutorFactory serves a hypequery.serve Api")
        self._api = api
        self._headers = headers
        self._execution_budget = execution_budget
        self._query_limits = query_limits
        self._catalog_budget = catalog_budget

    async def __call__(
        self, principal: McpPrincipal, credentials: Callable[[], Mapping[str, str]]
    ) -> ClientContractExecutor:
        del principal  # The API derives the principal again from the forwarded credential.
        headers: BackendHeaders = self._headers if self._headers is not None else credentials
        backend = ApiContractBackend(self._api, headers=headers)
        return await ClientContractExecutor.create(
            backend,
            budget=self._execution_budget,
            query_limits=self._query_limits,
            catalog_budget=self._catalog_budget,
        )


class HttpExecutorFactory:
    """Executors over an HTTPS client-contract URL, as one fixed backend principal.

    Callers' credentials are never forwarded: the backend credential is
    *headers*, so only a static MCP key may guard this server.
    """

    __slots__ = ("_headers", "_url")

    def __init__(self, url: str, *, headers: Mapping[str, str] | None = None) -> None:
        # Validates the URL now rather than on the first session.
        HttpContractBackend(url, headers=headers)
        self._url = url
        self._headers = dict(headers or {})

    async def __call__(
        self, principal: McpPrincipal, credentials: Callable[[], Mapping[str, str]]
    ) -> ClientContractExecutor:
        del principal, credentials
        return await ClientContractExecutor.create(
            HttpContractBackend(self._url, headers=self._headers)
        )


def check_resource_audience(
    authenticate: McpAuthenticator, resource: ProtectedResource | None
) -> None:
    """Refuse an OAuth setup whose tokens could have been issued for another resource.

    With a JWT strategy, the API must check the audience, and the MCP
    resource URL must be one of the audiences it accepts.
    """

    if resource is None or not isinstance(authenticate, ApiAuthenticator):
        return
    audiences = authenticate.audiences
    if audiences is not None and resource.resource not in audiences:
        raise ValueError(
            f"The API's jwt_strategy must accept audience {resource.resource!r}, the MCP "
            "resource URL, so tokens issued for any other resource are refused."
        )

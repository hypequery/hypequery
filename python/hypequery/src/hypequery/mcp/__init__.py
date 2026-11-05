"""A native MCP server for hypequery client contracts.

Exposes the same four tools as `@hypequery/mcp` (`list_datasets`,
`get_dataset_schema`, `query_metric`, `query_dataset`) and its `dataset_guide`
prompt, over an authorized client contract served by a `hypequery.serve` API:
in this process (`ApiContractBackend`) or over HTTPS (`HttpContractBackend`).
The SDK-backed servers (`create_mcp_server` with `serve_stdio`, and the
self-hosted Streamable HTTP `create_mcp_asgi_app`) need the `mcp` extra:
`pip install "hypequery[mcp]"`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .backends import (
    ApiContractBackend,
    BackendHeaders,
    BackendResponse,
    ContractBackend,
    HttpContractBackend,
)
from .budgets import CatalogBudget, ExecutionBudget, QueryLimits
from .errors import McpErrorDetails, McpToolError, McpToolErrorCategory, McpToolErrorCode
from .executor import ClientContractExecutor
from .http_auth import (
    ApiAuthenticator,
    McpAuthenticator,
    McpAuthError,
    McpPrincipal,
    StaticKeyAuthenticator,
    static_key_authenticator,
)
from .http_executors import ApiExecutorFactory, HttpExecutorFactory, check_resource_audience
from .utils.oauth import ProtectedResource

if TYPE_CHECKING:
    from .server import McpAsgiApp, create_mcp_asgi_app, create_mcp_server, serve_stdio

__all__ = [
    "ApiAuthenticator",
    "ApiContractBackend",
    "ApiExecutorFactory",
    "BackendHeaders",
    "BackendResponse",
    "CatalogBudget",
    "ClientContractExecutor",
    "ContractBackend",
    "ExecutionBudget",
    "HttpContractBackend",
    "HttpExecutorFactory",
    "McpAsgiApp",
    "McpAuthError",
    "McpAuthenticator",
    "McpErrorDetails",
    "McpPrincipal",
    "McpToolError",
    "McpToolErrorCategory",
    "McpToolErrorCode",
    "ProtectedResource",
    "QueryLimits",
    "StaticKeyAuthenticator",
    "check_resource_audience",
    "create_mcp_asgi_app",
    "create_mcp_server",
    "serve_stdio",
    "static_key_authenticator",
]


def __getattr__(name: str) -> Any:
    # The SDK is optional: import it only when the server is asked for.
    if name in ("McpAsgiApp", "create_mcp_asgi_app", "create_mcp_server", "serve_stdio"):
        from . import server

        return getattr(server, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

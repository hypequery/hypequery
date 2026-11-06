"""A native MCP server for hypequery client contracts.

Exposes the same four tools as `@hypequery/mcp` (`list_datasets`,
`get_dataset_schema`, `query_metric`, `query_dataset`) and its `dataset_guide`
prompt, over an authorized client contract served by a `hypequery.serve` API:
in this process (`ApiContractBackend`) or over HTTPS (`HttpContractBackend`).
The SDK-backed server (`create_mcp_server`, `serve_stdio`) needs the `mcp`
extra: `pip install "hypequery[mcp]"`.
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

if TYPE_CHECKING:
    from .server import create_mcp_server, serve_stdio

__all__ = [
    "ApiContractBackend",
    "BackendHeaders",
    "BackendResponse",
    "CatalogBudget",
    "ClientContractExecutor",
    "ContractBackend",
    "ExecutionBudget",
    "HttpContractBackend",
    "McpErrorDetails",
    "McpToolError",
    "McpToolErrorCategory",
    "McpToolErrorCode",
    "QueryLimits",
    "create_mcp_server",
    "serve_stdio",
]


def __getattr__(name: str) -> Any:
    # The SDK is optional: import it only when the server is asked for.
    if name in ("create_mcp_server", "serve_stdio"):
        from . import server

        return getattr(server, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

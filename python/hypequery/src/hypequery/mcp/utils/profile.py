"""Narrow a backend contract's endpoint limits to the MCP host's ceilings."""

from __future__ import annotations

from ...protocol import (
    ProtocolClientContract,
    ProtocolClientContractError,
    prepare_protocol_client_contract,
)
from ..budgets import QueryLimits
from ..errors import McpToolError

#: No MCP response carries more rows than this, whatever the backend allows.
MCP_MAX_ROWS = 1000


def mcp_client_profile(
    contract: ProtocolClientContract, limits: QueryLimits
) -> ProtocolClientContract:
    """Lower operational limits only; the backend's endpoint schema hashes are unchanged."""

    endpoints: list[dict[str, object]] = []
    for endpoint in contract["endpoints"]:
        own = endpoint["limits"]
        narrowed = {key: value for key, value in endpoint.items() if key != "schemaHash"}
        narrowed["limits"] = {
            **own,
            "maxLimit": min(own["maxLimit"], limits.max_result_size, MCP_MAX_ROWS),
            "defaultLimit": min(
                own["defaultLimit"],
                limits.default_result_size,
                limits.max_result_size,
                MCP_MAX_ROWS,
            ),
            "maxOffset": min(own["maxOffset"], limits.max_offset),
            "maxDimensions": min(own["maxDimensions"], limits.max_dimensions),
            "maxMeasures": min(own["maxMeasures"], limits.max_measures),
            "maxPredicates": min(own["maxPredicates"], limits.max_filters),
            "maxOrderBy": min(own["maxOrderBy"], limits.max_order_by),
            "maxFilterValues": min(own["maxFilterValues"], MCP_MAX_ROWS),
        }
        endpoints.append(narrowed)
    try:
        return prepare_protocol_client_contract(
            {
                "kind": contract["kind"],
                "version": contract["version"],
                "view": contract["view"],
                "endpoints": endpoints,
            }
        )["contract"]
    except ProtocolClientContractError:
        raise McpToolError(
            "MCP_CATALOG_TOO_LARGE",
            "Client defaults exceed MCP query ceilings; publish a narrower profile.",
            retryable=False,
        ) from None

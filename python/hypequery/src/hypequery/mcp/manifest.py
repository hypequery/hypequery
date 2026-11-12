"""The fixed four-tool manifest for an authorized client contract.

Mirrors `@hypequery/mcp`'s HTTP-bridge manifest (`clientHttpManifest` over
`buildMCPToolManifest`): the same names, titles, descriptions, annotations,
input schemas (`build_client_contract_tool_schemas`) and output schemas.
"""

from __future__ import annotations

from ..protocol import ClientContractToolSchemas
from .errors import McpToolErrorCategory, McpToolErrorCode

JsonSchema = dict[str, object]

_ENVELOPE_CODES: tuple[McpToolErrorCode, ...] = (
    "MCP_INVALID_ARGUMENTS",
    "MCP_NOT_FOUND",
    "MCP_UNKNOWN_TOOL",
    "MCP_UNAUTHORIZED",
    "MCP_STALE_CONTRACT",
    "MCP_REQUEST_CANCELLED",
    "MCP_QUERY_TIMEOUT",
    "MCP_RESULT_TOO_LARGE",
    "MCP_CATALOG_TOO_LARGE",
    "MCP_RATE_LIMITED",
    "MCP_EXECUTION_FAILED",
)
_CATEGORIES: tuple[McpToolErrorCategory, ...] = (
    "correctable_input",
    "unauthorized",
    "stale_contract",
    "budget",
    "internal",
)


def _error_envelope() -> JsonSchema:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "error": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "code": {"type": "string", "enum": list(_ENVELOPE_CODES)},
                    "message": {"type": "string"},
                    "category": {"type": "string", "enum": list(_CATEGORIES)},
                    "retryable": {"type": "boolean"},
                    "correctable": {"type": "boolean"},
                    "retryAfterSeconds": {"type": "number", "minimum": 0},
                    "relist": {"type": "boolean"},
                    "reason": {"type": "string"},
                },
                "required": ["code", "category", "message", "retryable", "correctable"],
            }
        },
        "required": ["error"],
    }


def _result(success: JsonSchema) -> JsonSchema:
    return {"type": "object", "oneOf": [success, _error_envelope()]}


def _count() -> JsonSchema:
    return {"type": "integer", "minimum": 0}


def _profile_output() -> JsonSchema:
    return _result(
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["name", "queryable", "endpoints"],
            "properties": {
                "name": {"type": "string"},
                "label": {"type": "string"},
                "description": {"type": "string"},
                "queryable": {"type": "boolean"},
                "endpoints": {"type": "array", "items": {"type": "object"}},
            },
        }
    )


def _list_output() -> JsonSchema:
    return _result(
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["datasets", "total"],
            "properties": {
                "datasets": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": [
                            "name",
                            "description",
                            "queryable",
                            "dimensionCount",
                            "measureCount",
                            "metricCount",
                        ],
                        "properties": {
                            "name": {"type": "string"},
                            "label": {"type": "string"},
                            "description": {"type": "string"},
                            "queryable": {"type": "boolean"},
                            "dimensionCount": _count(),
                            "measureCount": _count(),
                            "metricCount": _count(),
                        },
                    },
                },
                "total": _count(),
            },
        }
    )


def _query_output() -> JsonSchema:
    return _result(
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["data"],
            "properties": {
                "data": {
                    "type": "array",
                    "maxItems": 1000,
                    "items": {
                        "type": "object",
                        "additionalProperties": {"type": ["string", "number", "boolean", "null"]},
                    },
                },
                "meta": {
                    "type": ["object", "null"],
                    "additionalProperties": False,
                    "required": ["requestId", "timingMs", "rowCount", "pagination"],
                    "properties": {
                        "requestId": {"type": "string"},
                        "timingMs": {"type": "number", "minimum": 0},
                        "rowCount": _count(),
                        "pagination": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["limit", "offset", "hasMore"],
                            "properties": {
                                "limit": {"type": "integer", "minimum": 1},
                                "offset": _count(),
                                "hasMore": {"type": "boolean"},
                            },
                        },
                        "cache": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["hit"],
                            "properties": {"hit": {"type": "boolean"}},
                        },
                    },
                },
            },
        }
    )


def _annotations(title: str) -> dict[str, object]:
    return {
        "title": title,
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    }


def client_tool_manifest(
    schemas: ClientContractToolSchemas, authorized_hash: str
) -> dict[str, object]:
    """`tools/list` for one authorized contract, stamped with its identities."""

    return {
        "tools": [
            {
                "name": "list_datasets",
                "title": "List datasets",
                "description": (
                    "List authorized dataset groups with their descriptions, including "
                    "metric-only groups whose queryable flag is false."
                ),
                "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
                "outputSchema": _list_output(),
                "annotations": _annotations("List datasets"),
            },
            {
                "name": "get_dataset_schema",
                "title": "Inspect dataset schema",
                "description": (
                    "Inspect authorized endpoint profiles for a dataset group. Each endpoint "
                    "retains its own permissions and defaults; annotations carry "
                    "backend-authored field labels, descriptions, synonyms, example values, "
                    "formats, units and currencies."
                ),
                "inputSchema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {"dataset": {"type": "string"}},
                    "required": ["dataset"],
                },
                "outputSchema": _profile_output(),
                "annotations": _annotations("Inspect dataset schema"),
            },
            {
                "name": "query_metric",
                "title": "Query named metric",
                "description": (
                    "Execute a metric query with optional dimensions, filters, time grain, "
                    "and sorting"
                ),
                "inputSchema": schemas["query_metric"],
                "outputSchema": _query_output(),
                "annotations": _annotations("Query named metric"),
            },
            {
                "name": "query_dataset",
                "title": "Query dataset",
                "description": (
                    "Execute an ad-hoc dataset query with custom dimensions and measures"
                ),
                "inputSchema": schemas["query_dataset"],
                "outputSchema": _query_output(),
                "annotations": _annotations("Query dataset"),
            },
        ],
        "_meta": {
            "com.hypequery/clientContractHash": authorized_hash,
            "com.hypequery/manifestHash": schemas["manifest_hash"],
        },
    }

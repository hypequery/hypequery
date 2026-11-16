"""The tool manifest for an authorized client contract.

Mirrors `@hypequery/mcp`'s HTTP-bridge manifest (`clientHttpManifest` over
`buildMCPToolManifest`): the same names, titles, descriptions, annotations,
input schemas (the provider-ready form of `build_client_contract_tool_schemas`'s,
leaving out a query tool nothing is offered under) and output schemas. With
business context, `list_datasets` takes `buildMCPToolManifest`'s business-context
wording and output field, and `get_business_context` is listed last, as
`createMCPExecutor({ businessContext })` lists them.
"""

from __future__ import annotations

from ..protocol import ClientContractToolSchemas
from .errors import McpToolErrorCategory, McpToolErrorCode
from .utils.model_input_schema import accepts_no_input, to_model_input_schema

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
                    "hint": {"type": "string"},
                    "docsUrl": {"type": "string"},
                    "requestId": {"type": "string"},
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


def _business_context_properties() -> JsonSchema:
    """Every business context field, as `@hypequery/mcp` declares them."""

    def pair(key: str, value: str) -> JsonSchema:
        return {
            "type": "object",
            "additionalProperties": False,
            "properties": {key: {"type": "string"}, value: {"type": "string"}},
            "required": [key, value],
        }

    return {
        "summary": {"type": "string"},
        "industry": {"type": "string"},
        "businessModel": {"type": "string"},
        "customers": {"type": "string"},
        "audience": {"type": "string"},
        "goals": {"type": "array", "items": {"type": "string"}},
        "kpis": {"type": "array", "items": pair("name", "definition")},
        "glossary": {"type": "array", "items": pair("term", "meaning")},
        "conventions": {"type": "string"},
        "caveats": {"type": "array", "items": {"type": "string"}},
    }


def _business_context_output() -> JsonSchema:
    return _result(
        {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "businessContext": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": _business_context_properties(),
                }
            },
            "required": ["businessContext"],
        }
    )


def _listed_business_context() -> JsonSchema:
    """`list_datasets`' `businessContext`: the whole context, or its summary and a pointer."""

    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            **_business_context_properties(),
            "truncated": {"type": "boolean"},
            "hint": {"type": "string"},
        },
    }


def _list_output(*, business_context: bool = False) -> JsonSchema:
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
                **({"businessContext": _listed_business_context()} if business_context else {}),
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


def _query_tool(
    exact: JsonSchema, name: str, title: str, description: str
) -> list[dict[str, object]]:
    """A query tool as clients receive it, or none when nothing is offered under it.

    The advertised input schema is the provider-ready form of the exact one: model
    APIs reject a top-level `anyOf`, and clients such as Claude Code drop the tool
    silently. Calls are still validated against the exact schema.
    """

    if accepts_no_input(exact):
        return []
    return [
        {
            "name": name,
            "title": title,
            "description": description,
            "inputSchema": to_model_input_schema(exact),
            "outputSchema": _query_output(),
            "annotations": _annotations(title),
        }
    ]


LIST_DATASETS_DESCRIPTION = (
    "List authorized dataset groups with their descriptions, including "
    "metric-only groups whose queryable flag is false."
)
#: `@hypequery/mcp`'s wording when `list_datasets` carries business context.
LIST_DATASETS_WITH_CONTEXT_DESCRIPTION = (
    "List all available datasets in the semantic layer, with the business context "
    "(KPIs, glossary, conventions, caveats) to interpret them"
)


def business_context_tool() -> dict[str, object]:
    """`get_business_context`, exactly as `@hypequery/mcp` advertises it."""

    return {
        "name": "get_business_context",
        "title": "Get business context",
        "description": (
            "Get the business context for these datasets: what the business does, KPI "
            "definitions, the glossary of business terms, reporting conventions (currency, "
            "time zone, fiscal year) and known data caveats. Read it before interpreting or "
            "presenting numbers."
        ),
        "inputSchema": {"type": "object", "properties": {}},
        "outputSchema": _business_context_output(),
        "annotations": _annotations("Get business context"),
    }


def client_tool_manifest(
    schemas: ClientContractToolSchemas,
    authorized_hash: str,
    *,
    business_context: bool = False,
) -> dict[str, object]:
    """`tools/list` for one authorized contract, stamped with its identities.

    With *business_context*, `list_datasets` says it carries the context and
    `get_business_context` is listed last. The manifest hash is unchanged:
    business context is guidance, not part of the query contract.
    """

    return {
        "tools": [
            {
                "name": "list_datasets",
                "title": "List datasets",
                "description": (
                    LIST_DATASETS_WITH_CONTEXT_DESCRIPTION
                    if business_context
                    else LIST_DATASETS_DESCRIPTION
                ),
                "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
                "outputSchema": _list_output(business_context=business_context),
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
            *_query_tool(
                schemas["query_metric"],
                "query_metric",
                "Query named metric",
                "Execute a metric query with optional dimensions, filters, time grain, and sorting",
            ),
            *_query_tool(
                schemas["query_dataset"],
                "query_dataset",
                "Query dataset",
                "Execute an ad-hoc dataset query with custom dimensions and measures",
            ),
            *([business_context_tool()] if business_context else []),
        ],
        "_meta": {
            "com.hypequery/clientContractHash": authorized_hash,
            "com.hypequery/manifestHash": schemas["manifest_hash"],
        },
    }

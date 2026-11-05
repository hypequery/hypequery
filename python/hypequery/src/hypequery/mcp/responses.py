"""Tool results in the MCP `CallToolResult` shape, as plain JSON data."""

from __future__ import annotations

import json

from .errors import McpErrorDetails, classify_mcp_tool_error, format_mcp_tool_error

ToolResult = dict[str, object]


def compact_json(value: object) -> str:
    """JSON text as `JSON.stringify` writes it: no spaces, non-ASCII kept."""

    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def tool_response(value: dict[str, object]) -> ToolResult:
    return {"content": [{"type": "text", "text": compact_json(value)}], "structuredContent": value}


def error_response(error: BaseException) -> ToolResult:
    details = classify_mcp_tool_error(error)
    return {
        "content": [{"type": "text", "text": format_mcp_tool_error(error)}],
        "structuredContent": {"error": dict(details)},
        "isError": True,
    }


def result_too_large_response() -> ToolResult:
    """The smallest valid error, used when even the original error is over budget."""

    details: McpErrorDetails = {
        "code": "MCP_RESULT_TOO_LARGE",
        "category": "budget",
        "message": "Result exceeds response byte limit",
        "retryable": False,
        "correctable": False,
    }
    return {
        "content": [{"type": "text", "text": f"Error [{details['code']}]: {details['message']}"}],
        "structuredContent": {"error": dict(details)},
        "isError": True,
    }

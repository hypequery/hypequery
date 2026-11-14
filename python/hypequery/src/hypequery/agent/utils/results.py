"""MCP `CallToolResult` JSON to hypequery results, as `@hypequery/agent` reads it."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import replace

from ..errors import HypequeryToolsError
from ..types import (
    JsonObject,
    ToolDefinition,
    ToolErrorDetails,
    ToolFailure,
    ToolResult,
    ToolSuccess,
)

#: The `_meta` key hypequery Cloud puts a call's request id under.
REQUEST_ID_META_KEY = "com.hypequery/requestId"

_FORMATTED_ERROR = re.compile(r"^Error \[([A-Z_]+)\]: (.*)$", re.DOTALL)


def _optional_string(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def read_error_envelope(value: object) -> ToolErrorDetails | None:
    """hypequery's envelope from a value, keeping only the fields it defines."""

    if not isinstance(value, Mapping):
        return None
    code, message = value.get("code"), value.get("message")
    if not isinstance(code, str) or not isinstance(message, str):
        return None
    category = value.get("category")
    retry_after = value.get("retryAfterSeconds")
    relist = value.get("relist")
    return ToolErrorDetails(
        code=code,
        category=category if isinstance(category, str) else "internal",
        message=message,
        retryable=value.get("retryable") is True,
        correctable=value.get("correctable") is True,
        retry_after_seconds=(
            float(retry_after)
            if isinstance(retry_after, int | float) and not isinstance(retry_after, bool)
            else None
        ),
        relist=relist if isinstance(relist, bool) else None,
        reason=_optional_string(value.get("reason")),
        hint=_optional_string(value.get("hint")),
        docs_url=_optional_string(value.get("docsUrl")),
        request_id=_optional_string(value.get("requestId")),
    )


def read_request_id(result: Mapping[str, object]) -> str | None:
    """The request id from a result's `_meta`, if the server sent one."""

    meta = result.get("_meta")
    return _optional_string(meta.get(REQUEST_ID_META_KEY)) if isinstance(meta, Mapping) else None


def _text_of(result: Mapping[str, object]) -> str | None:
    content = result.get("content")
    if not isinstance(content, list):
        return None
    texts = [
        part["text"]
        for part in content
        if isinstance(part, Mapping)
        and part.get("type") == "text"
        and isinstance(part.get("text"), str)
    ]
    return "\n".join(texts) if texts else None


def _parse_json(text: str) -> object | None:
    try:
        parsed: object = json.loads(text)
    except ValueError:
        return None
    return parsed


def error_from_result(result: Mapping[str, object]) -> ToolErrorDetails:
    """The envelope of an `isError` result: structured when sent, otherwise from its text."""

    structured = result.get("structuredContent")
    if isinstance(structured, Mapping):
        envelope = read_error_envelope(structured.get("error"))
        if envelope is not None:
            return envelope
    text = _text_of(result) or "Tool call failed"
    parsed = _parse_json(text)
    if isinstance(parsed, Mapping):
        envelope = read_error_envelope(parsed.get("error"))
        if envelope is not None:
            return envelope
    # `formatMCPToolError` text: "Error [CODE]: message".
    formatted = _FORMATTED_ERROR.match(text)
    return ToolErrorDetails(
        code=formatted[1] if formatted else "MCP_EXECUTION_FAILED",
        category="internal",
        message=formatted[2] if formatted else text,
        retryable=False,
        correctable=False,
    )


def data_from_result(result: Mapping[str, object]) -> object:
    """A successful result's data: `structuredContent`, else its text as JSON, else the text."""

    if "structuredContent" in result and result["structuredContent"] is not None:
        return result["structuredContent"]
    text = _text_of(result)
    if text is None:
        return result.get("content")
    parsed = _parse_json(text)
    return text if parsed is None else parsed


def to_tool_result(name: str, raw: Mapping[str, object]) -> ToolResult:
    """An MCP `CallToolResult` as a hypequery result: the data, or the error envelope."""

    request_id = read_request_id(raw)
    if raw.get("isError") is True:
        error = error_from_result(raw)
        if error.request_id is None and request_id is not None:
            error = replace(error, request_id=request_id)
        return ToolFailure(
            tool=name, error=error, request_id=request_id or error.request_id, raw=raw
        )
    return ToolSuccess(tool=name, data=data_from_result(raw), request_id=request_id, raw=raw)


def to_model_output(result: ToolResult) -> object:
    """What the model sees: the data, or `{"error": ...}` with hypequery's envelope."""

    return result.data if isinstance(result, ToolSuccess) else {"error": result.error.to_envelope()}


def to_definition(tool: Mapping[str, object]) -> ToolDefinition:
    """One tool from an MCP `tools/list` page."""

    name = tool.get("name")
    schema = tool.get("inputSchema")
    if not isinstance(name, str) or not isinstance(schema, Mapping):
        raise HypequeryToolsError(
            ToolErrorDetails(
                code="MCP_EXECUTION_FAILED",
                category="internal",
                message="The server listed a tool without a name or input schema.",
                retryable=False,
                correctable=False,
            )
        )

    def optional_object(key: str) -> JsonObject | None:
        value = tool.get(key)
        return dict(value) if isinstance(value, Mapping) else None

    description = tool.get("description")
    title = tool.get("title")
    return ToolDefinition(
        name=name,
        description=description if isinstance(description, str) else "",
        input_schema=dict(schema),
        title=title if isinstance(title, str) else None,
        output_schema=optional_object("outputSchema"),
        annotations=optional_object("annotations"),
    )


def to_arguments(name: str, arguments: object) -> JsonObject:
    """A call's input as MCP arguments: `{}` for none, a `TypeError` for anything but a mapping."""

    if arguments is None:
        return {}
    if not isinstance(arguments, Mapping):
        raise TypeError(f"hypequery tools: input for {name} must be an object.")
    return dict(arguments)

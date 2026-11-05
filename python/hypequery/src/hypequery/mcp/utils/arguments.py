"""Tool argument intake: a plain object with only the tool's own keys."""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from ..errors import McpToolError


def tool_arguments(value: object, allowed: Sequence[str]) -> dict[str, object]:
    """Copy *value*'s members, refusing anything but a mapping of allowed string keys.

    Nested query values are left to the shared bounded client-query validator.
    """

    source: object = {} if value is None else value
    if not isinstance(source, Mapping) or len(source) > len(allowed):
        raise McpToolError("MCP_INVALID_ARGUMENTS", "Invalid client tool arguments.")
    result: dict[str, object] = {}
    for key, item in source.items():
        if type(key) is not str or key not in allowed:
            raise McpToolError("MCP_INVALID_ARGUMENTS", "Invalid client tool arguments.")
        result[key] = item
    return result

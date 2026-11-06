"""MCP tool error codes, categories and their public envelope.

Mirrors `@hypequery/mcp`'s `errors.ts`: the same eleven codes, the same default
category, retryable and correctable flags, and the same `Error [CODE]: msg`
text, so an agent sees one error vocabulary whichever language serves it.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, NotRequired, TypedDict

McpToolErrorCode = Literal[
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
]

McpToolErrorCategory = Literal[
    "correctable_input", "unauthorized", "stale_contract", "budget", "internal"
]


class McpErrorDetails(TypedDict):
    code: McpToolErrorCode
    category: McpToolErrorCategory
    message: str
    retryable: bool
    correctable: bool
    #: Seconds to wait before retrying, when the host knows (a rate limit, an outage).
    retryAfterSeconds: NotRequired[float]
    #: The caller must re-read discovery (`list_datasets`, schemas) before retrying.
    relist: NotRequired[bool]
    #: The host's own stable code for this failure; `code` stays the portable class.
    reason: NotRequired[str]


@dataclass(frozen=True, slots=True)
class _Defaults:
    category: McpToolErrorCategory
    retryable: bool
    correctable: bool


_DEFAULTS: dict[McpToolErrorCode, _Defaults] = {
    "MCP_INVALID_ARGUMENTS": _Defaults("correctable_input", False, True),
    "MCP_NOT_FOUND": _Defaults("correctable_input", False, True),
    "MCP_UNKNOWN_TOOL": _Defaults("correctable_input", False, True),
    "MCP_UNAUTHORIZED": _Defaults("unauthorized", False, False),
    "MCP_STALE_CONTRACT": _Defaults("stale_contract", True, False),
    # The same catalog produces the same manifest every time, so a catalog
    # too large to advertise is not retryable.
    "MCP_REQUEST_CANCELLED": _Defaults("budget", False, False),
    "MCP_RESULT_TOO_LARGE": _Defaults("budget", False, False),
    "MCP_CATALOG_TOO_LARGE": _Defaults("budget", False, False),
    "MCP_QUERY_TIMEOUT": _Defaults("budget", True, False),
    "MCP_RATE_LIMITED": _Defaults("budget", True, False),
    "MCP_EXECUTION_FAILED": _Defaults("internal", True, False),
}


class McpToolError(Exception):
    """A tool failure whose message is safe to show the agent."""

    def __init__(
        self,
        code: McpToolErrorCode,
        message: str,
        *,
        category: McpToolErrorCategory | None = None,
        retryable: bool | None = None,
        correctable: bool | None = None,
        retry_after_seconds: float | None = None,
        relist: bool | None = None,
        reason: str | None = None,
    ) -> None:
        super().__init__(message)
        defaults = _DEFAULTS[code]
        self.code: McpToolErrorCode = code
        self.message = message
        self.category: McpToolErrorCategory = category or defaults.category
        self.retryable = defaults.retryable if retryable is None else retryable
        self.correctable = defaults.correctable if correctable is None else correctable
        if retry_after_seconds is not None and (
            type(retry_after_seconds) not in (int, float)
            or not math.isfinite(retry_after_seconds)
            or retry_after_seconds < 0
        ):
            raise ValueError("retry_after_seconds must be a finite, non-negative number")
        self.retry_after_seconds = retry_after_seconds
        self.relist = relist
        self.reason = reason


def stale_contract() -> McpToolError:
    """The backend's contract changed; the agent must reconnect, not retry."""

    return McpToolError(
        "MCP_STALE_CONTRACT", "Backend client contract changed; reconnect.", retryable=False
    )


def result_too_large(message: str) -> McpToolError:
    return McpToolError("MCP_RESULT_TOO_LARGE", message)


def classify_mcp_tool_error(error: BaseException) -> McpErrorDetails:
    """The public details of *error*; anything unexpected is a generic failure."""

    if isinstance(error, McpToolError):
        details: McpErrorDetails = {
            "code": error.code,
            "category": error.category,
            "message": error.message,
            "retryable": error.retryable,
            "correctable": error.correctable,
        }
        if error.retry_after_seconds is not None:
            details["retryAfterSeconds"] = error.retry_after_seconds
        if error.relist is not None:
            details["relist"] = error.relist
        if error.reason is not None:
            details["reason"] = error.reason
        return details
    return {
        "code": "MCP_EXECUTION_FAILED",
        "category": "internal",
        "message": "Query execution failed",
        "retryable": True,
        "correctable": False,
    }


def format_mcp_tool_error(error: BaseException) -> str:
    details = classify_mcp_tool_error(error)
    return f"Error [{details['code']}]: {details['message']}"

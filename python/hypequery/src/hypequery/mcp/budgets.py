"""Execution, catalog and query ceilings, with `@hypequery/mcp`'s defaults."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TypeVar

import anyio

from .errors import McpToolError, result_too_large
from .responses import compact_json, result_too_large_response

T = TypeVar("T")

DEFAULT_QUERY_TIMEOUT_SECONDS = 30.0
MAX_QUERY_TIMEOUT_SECONDS = 120.0
DEFAULT_RESPONSE_BYTES = 1_048_576
MAX_RESPONSE_BYTES = 10_485_760
#: A budget must at least fit the error that reports an over-budget result.
MIN_RESPONSE_BYTES = len(compact_json(result_too_large_response()).encode("utf-8"))
DEFAULT_MANIFEST_TOOLS = 64
MAX_MANIFEST_TOOLS = 256
DEFAULT_MANIFEST_BYTES = 262_144
MAX_MANIFEST_BYTES = 1_048_576


def _bounded(value: int, name: str, minimum: int, maximum: int) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{name} must be an integer between {minimum} and {maximum}")
    return value


@dataclass(frozen=True, slots=True)
class ExecutionBudget:
    """Per-request deadline and response size."""

    timeout_seconds: float = DEFAULT_QUERY_TIMEOUT_SECONDS
    max_response_bytes: int = DEFAULT_RESPONSE_BYTES

    def __post_init__(self) -> None:
        if (
            type(self.timeout_seconds) not in (int, float)
            or not 0 < self.timeout_seconds <= MAX_QUERY_TIMEOUT_SECONDS
        ):
            raise ValueError(
                f"timeout_seconds must be greater than 0 and at most {MAX_QUERY_TIMEOUT_SECONDS:g}"
            )
        _bounded(
            self.max_response_bytes, "max_response_bytes", MIN_RESPONSE_BYTES, MAX_RESPONSE_BYTES
        )


@dataclass(frozen=True, slots=True)
class CatalogBudget:
    """How large a tool manifest may be advertised."""

    max_tools: int = DEFAULT_MANIFEST_TOOLS
    max_manifest_bytes: int = DEFAULT_MANIFEST_BYTES

    def __post_init__(self) -> None:
        _bounded(self.max_tools, "max_tools", 1, MAX_MANIFEST_TOOLS)
        _bounded(self.max_manifest_bytes, "max_manifest_bytes", 1, MAX_MANIFEST_BYTES)


@dataclass(frozen=True, slots=True)
class QueryLimits:
    """Host ceilings that narrow every advertised endpoint's own limits."""

    default_result_size: int = 100
    max_result_size: int = 10_000
    max_offset: int = 10_000
    max_dimensions: int = 50
    max_measures: int = 50
    max_filters: int = 100
    max_order_by: int = 50

    def __post_init__(self) -> None:
        _bounded(self.max_result_size, "max_result_size", 1, 10_000)
        _bounded(self.default_result_size, "default_result_size", 1, 10_000)
        _bounded(self.max_offset, "max_offset", 0, 10_000)
        _bounded(self.max_dimensions, "max_dimensions", 1, 50)
        _bounded(self.max_measures, "max_measures", 1, 50)
        _bounded(self.max_filters, "max_filters", 1, 100)
        _bounded(self.max_order_by, "max_order_by", 1, 50)


async def within_budget(operation: Callable[[], Awaitable[T]], budget: ExecutionBudget) -> T:
    """Run *operation* under the budget's deadline."""

    with anyio.move_on_after(budget.timeout_seconds) as scope:
        return await operation()
    if scope.cancelled_caught:
        raise McpToolError(
            "MCP_QUERY_TIMEOUT",
            f"The query exceeded its {round(budget.timeout_seconds * 1000)}ms execution deadline",
        )
    raise AssertionError("unreachable")  # pragma: no cover


def assert_within_budget(value: object, budget: ExecutionBudget) -> None:
    size = len(compact_json(value).encode("utf-8"))
    if size > budget.max_response_bytes:
        raise result_too_large(
            f"The serialized result is {size} bytes; maximum is {budget.max_response_bytes} bytes"
        )


def assert_manifest_within_budget(
    manifest: dict[str, object], budget: CatalogBudget
) -> dict[str, object]:
    """Refuse a manifest too large to advertise, naming the ceiling it hit."""

    tools = manifest["tools"]
    count = len(tools) if isinstance(tools, list) else 0
    if count > budget.max_tools:
        raise McpToolError(
            "MCP_CATALOG_TOO_LARGE",
            f"The tool manifest advertises {count} tools; maximum is {budget.max_tools}",
        )
    size = len(compact_json(manifest).encode("utf-8"))
    if size > budget.max_manifest_bytes:
        raise McpToolError(
            "MCP_CATALOG_TOO_LARGE",
            f"The tool manifest is {size} bytes across {count} tools; "
            f"maximum is {budget.max_manifest_bytes} bytes",
        )
    return manifest

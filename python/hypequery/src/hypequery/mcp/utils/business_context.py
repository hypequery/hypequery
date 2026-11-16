"""Business context as agents read it, ported from `@hypequery/mcp`.

The executor carries the document without its `kind`/`version` header: whole in
`list_datasets` when small, and from `get_business_context`. It is guidance
only, so it never changes the manifest hash or what a query returns.
"""

from __future__ import annotations

import copy
from collections.abc import Mapping
from typing import Any

from ...protocol import is_empty_protocol_business_context, validate_protocol_business_context
from ...protocol.js_strings import js_trim_end
from ..responses import compact_json

#: The largest business context `list_datasets` carries in full, in UTF-8 bytes
#: of its JSON. Above it, `list_datasets` carries the summary only and points at
#: `get_business_context`, so a large glossary can never push the catalog the
#: agent reads first over its result budget.
LIST_DATASETS_CONTEXT_INLINE_BYTES = 32 * 1024

TRUNCATED_CONTEXT_HINT = (
    "This business context is too large to list here. Call get_business_context for the "
    "KPIs, glossary, conventions and caveats."
)

McpBusinessContext = dict[str, object]
"""Business context as an agent reads it: the document without its header."""


def resolve_mcp_business_context(
    document: Mapping[str, object] | None,
) -> McpBusinessContext | None:
    """Validate the configured document and drop its header.

    An empty document is the same as none, so it adds no tool and changes no
    listing. Raises `ProtocolBusinessContextError` for an invalid document.
    """

    if document is None:
        return None
    validated = validate_protocol_business_context(
        dict(document) if not isinstance(document, dict) else document
    )
    if is_empty_protocol_business_context(validated):
        return None
    return {key: value for key, value in validated.items() if key not in ("kind", "version")}


def copy_business_context(context: McpBusinessContext) -> McpBusinessContext:
    """A deep copy, so a tool result never shares lists or entries with the executor's document."""

    return copy.deepcopy(context)


def list_datasets_business_context(context: McpBusinessContext) -> dict[str, object]:
    """The context `list_datasets` returns: all of it when small, else the summary and a pointer."""

    if len(compact_json(context).encode("utf-8")) <= LIST_DATASETS_CONTEXT_INLINE_BYTES:
        return copy_business_context(context)
    listed: dict[str, object] = {}
    if "summary" in context:
        listed["summary"] = context["summary"]
    listed["truncated"] = True
    listed["hint"] = TRUNCATED_CONTEXT_HINT
    return listed


def _section(title: str, lines: list[str]) -> list[str]:
    return [] if not lines else [f"## {title}", *lines, ""]


def _items(context: Mapping[str, object], key: str) -> list[Any]:
    value = context.get(key)
    return list(value) if isinstance(value, list) else []


def format_business_context(context: Mapping[str, object]) -> str:
    """Business context as Markdown, for an agent's system prompt or instructions.

    Accepts the document (from `define_business_context`), which is validated
    first, or the headerless form `get_business_context` returns. The same text
    for the same document, in the document's own order: byte for byte what
    `@hypequery/mcp`'s `formatBusinessContext` writes.
    """

    resolved: Mapping[str, object] = (
        (resolve_mcp_business_context(context) or {}) if "kind" in context else context
    )
    about = [
        f"{label}{resolved[key]}"
        for key, label in (
            ("summary", ""),
            ("industry", "Industry: "),
            ("businessModel", "Business model: "),
            ("customers", "Customers: "),
            ("audience", "Audience: "),
        )
        if resolved.get(key) is not None
    ]
    conventions = resolved.get("conventions")
    lines = [
        "# Business context",
        "",
        *_section("About the business", about),
        *_section("Goals", [f"- {goal}" for goal in _items(resolved, "goals")]),
        *_section(
            "KPIs",
            [f"- **{kpi['name']}**: {kpi['definition']}" for kpi in _items(resolved, "kpis")],
        ),
        *_section(
            "Glossary",
            [f"- **{item['term']}**: {item['meaning']}" for item in _items(resolved, "glossary")],
        ),
        *_section("Reporting conventions", [] if conventions is None else [f"{conventions}"]),
        *_section("Data caveats", [f"- {caveat}" for caveat in _items(resolved, "caveats")]),
    ]
    return js_trim_end("\n".join(lines)) + "\n"

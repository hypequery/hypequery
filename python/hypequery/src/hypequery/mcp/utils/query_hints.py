"""What a rejected client query could have used instead, as `@hypequery/mcp` says it.

Each hint is a sentence appended to an `MCP_INVALID_ARGUMENTS` message. It names
only contract members, which the tool list already offers this principal, and
never a submitted value. The text matches the TypeScript HTTP bridge's.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping

from ...protocol import ProtocolClientContract, ProtocolClientEndpoint

#: At most this many names in one hint; a catalog can be large.
_MAX_NAMES = 50
_FIELD_POINTER = re.compile(r"^/(dimensions|measures|filters|orderBy|having)/\d+(/(field))?$")


def client_query_target_hint(contract: ProtocolClientContract, tool: str) -> str:
    """The datasets (or metrics) a query tool offers, for an unknown target."""

    if tool == "query_dataset":
        return _offered(
            "Datasets", [_quote(e["id"]) for e in contract["endpoints"] if e["kind"] == "dataset"]
        )
    return _offered(
        "Metrics",
        [
            f"{_quote(e['id'])} on {_quote(e['dataset'])}"
            for e in contract["endpoints"]
            if e["kind"] == "metric"
        ],
    )


def client_query_field_hint(endpoint: ProtocolClientEndpoint, path: str) -> str:
    """The names a field pointer (`/dimensions/0`, `/filters/1/field`, ...) may take."""

    names = _field_names(endpoint, path)
    if names is None:
        return ""
    if not names:
        return f" {_quote(endpoint['id'])} offers none."
    return _offered(f"Offered by {_quote(endpoint['id'])}", [_quote(name) for name in names])


def _field_names(endpoint: ProtocolClientEndpoint, path: str) -> list[str] | None:
    match = _FIELD_POINTER.match(path)
    if match is None:
        return None
    member, leaf = match.group(1), match.group(3)
    dimensions: Mapping[str, Mapping[str, object]] = endpoint["dimensions"]
    measures = list(endpoint["measures"])
    if member == "dimensions" and leaf is None:
        return [name for name, field in dimensions.items() if field.get("groupable") is True]
    if member == "measures" and leaf is None:
        return measures
    if member == "filters" and leaf == "field":
        return list(endpoint["filters"])
    if member == "having" and leaf == "field":
        return measures
    if member == "orderBy" and leaf == "field":
        orderable = [name for name, field in dimensions.items() if field.get("orderable") is True]
        return [*orderable, *measures]
    return None


def _offered(label: str, names: list[str]) -> str:
    if not names:
        return ""
    shown = ", ".join(names[:_MAX_NAMES])
    more = f", and {len(names) - _MAX_NAMES} more" if len(names) > _MAX_NAMES else ""
    return f" {label}: {shown}{more}."


def _quote(name: str) -> str:
    return json.dumps(name, ensure_ascii=False)

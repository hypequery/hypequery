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
_FIELD_POINTER = re.compile(
    r"^/(dimensions|measures|filters|orderBy|having)/\d+(/(field|measure))?$"
)


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
    """The names a field pointer may take, for the pointers the validator emits.

    `/dimensions/N`, `/measures/N`, `/filters/N/field`, `/having/N/measure` and
    `/orderBy/N/field`. `having` and `orderBy` accept only what the query also
    selects, and the hint says so.
    """

    hint = _field_hint(endpoint, path)
    if hint is None:
        return ""
    label, names = hint
    if not names:
        return f" {_quote(endpoint['id'])} offers none."
    return _offered(label, names)


def _field_hint(endpoint: ProtocolClientEndpoint, path: str) -> tuple[str, list[str]] | None:
    """The hint's label and its names, already quoted."""

    match = _FIELD_POINTER.match(path)
    if match is None:
        return None
    member, leaf = match.group(1), match.group(3)
    endpoint_id = _quote(endpoint["id"])
    dimensions: Mapping[str, Mapping[str, object]] = endpoint["dimensions"]
    measures: Mapping[str, Mapping[str, object]] = endpoint["measures"]
    if member == "dimensions" and leaf is None:
        groupable = [_quote(n) for n, f in dimensions.items() if f.get("groupable") is True]
        return f"Offered by {endpoint_id}", groupable
    if member == "measures" and leaf is None:
        return f"Offered by {endpoint_id}", [_quote(name) for name in measures]
    if member == "filters" and leaf == "field":
        return f"Offered by {endpoint_id}", [_quote(name) for name in endpoint["filters"]]
    if member == "having" and leaf == "measure":
        allowed = [_quote(n) for n, m in measures.items() if m.get("having") is True]
        return f"A selected measure {endpoint_id} allows in having", allowed
    if member == "orderBy" and leaf == "field":
        orderable = [
            _quote(n)
            for n, f in dimensions.items()
            if f.get("groupable") is True and f.get("orderable") is True
        ]
        period = [] if endpoint["time"] is None else [f"{_quote('period')} (with a grain)"]
        return (
            f"A selected field {endpoint_id} can order by, once each",
            [*orderable, *(_quote(name) for name in measures), *period],
        )
    return None


def _offered(label: str, names: list[str]) -> str:
    if not names:
        return ""
    shown = ", ".join(names[:_MAX_NAMES])
    more = f", and {len(names) - _MAX_NAMES} more" if len(names) > _MAX_NAMES else ""
    return f" {label}: {shown}{more}."


def _quote(name: str) -> str:
    return json.dumps(name, ensure_ascii=False)

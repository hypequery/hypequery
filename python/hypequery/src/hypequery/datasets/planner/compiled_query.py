"""The compiled query: the only way a runtime asks an adapter to execute.

SQL text is trusted build or planner output; a caller influences execution only
through declared parameters and never through text. The debug form beside it is
what logs and diagnostics get: the same structure with the same declared types,
no values, and placeholder syntax no driver will accept.
"""

from __future__ import annotations

import secrets
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Literal, TypeAlias

from .context import Deadline
from .errors import CompiledQueryError
from .parameters import TypedParameter
from .settings import DEFAULT_QUERY_SETTINGS, QuerySettings

#: RFC 0010's closed operation set. The operation belongs to the compiled query,
#: never to the request, so an adapter can refuse a mismatch before executing.
CompiledQueryOperation: TypeAlias = Literal["query", "command", "insert"]

#: RFC 0011's bound, repeated here because the correlation identifier is shared
#: with the event contract and both must agree on what fits.
MAX_CORRELATION_ID_BYTES = 1_024


def _new_query_id() -> str:
    """A unique, unguessable identifier, safe for logs and cache metadata."""

    return secrets.token_hex(16)


def validate_correlation_id(value: str | None) -> str | None:
    """Bound a caller's correlation identifier and strip nothing silently.

    It is never authoritative and never influences routing, cache keys, or
    authorization — it only has to be safe to write into a log line.
    """

    if value is None:
        return None
    if type(value) is not str:
        raise CompiledQueryError("input-invalid", "a correlation identifier must be a string")
    for character in value:
        code = ord(character)
        if code <= 0x1F or code == 0x7F or 0x80 <= code <= 0x9F:
            raise CompiledQueryError(
                "input-invalid", "a correlation identifier may not contain control characters"
            )
    if len(value.encode("utf-8")) > MAX_CORRELATION_ID_BYTES:
        raise CompiledQueryError(
            "too-large",
            f"a correlation identifier may not exceed {MAX_CORRELATION_ID_BYTES} bytes",
        )
    return value


@dataclass(frozen=True, slots=True)
class CompiledQuery:
    """One execution request: trusted SQL, bound values, and its policy."""

    sql: str
    parameters: Mapping[str, TypedParameter]
    operation: CompiledQueryOperation = "query"
    settings: QuerySettings = DEFAULT_QUERY_SETTINGS
    deadline: Deadline | None = None
    correlation_id: str | None = None
    #: Server-generated and authoritative. A caller's correlation identifier is
    #: a separate field precisely so the two can never be confused.
    query_id: str = field(default_factory=_new_query_id)

    def to_sql(self) -> str:
        """The redacted debug form. Never executable, never carries a value."""

        debug = self.sql
        for parameter in self.parameters.values():
            debug = debug.replace(parameter.placeholder, parameter.debug_placeholder)
        return debug

    def parameter_values(self) -> dict[str, object]:
        """The name-to-value map a driver binds through server parameters."""

        return {name: parameter.value for name, parameter in self.parameters.items()}

    def describe(self) -> dict[str, object]:
        """A log-safe description: identifiers, structure, and setting names.

        Settings appear by name and value because they are policy, not caller
        data; parameter values never appear at all.
        """

        return {
            "queryId": self.query_id,
            "correlationId": self.correlation_id,
            "operation": self.operation,
            "sql": self.to_sql(),
            "parameters": {
                name: parameter.clickhouse_type for name, parameter in self.parameters.items()
            },
            "settings": dict(self.settings.values),
        }

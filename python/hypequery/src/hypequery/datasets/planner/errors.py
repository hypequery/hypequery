"""The RFC 0010 public error envelope.

One closed category set, one safe message, and the authoritative query
identifier. Categories are closed within the contract version: a new one needs
a new version, not a new string. Everything a runtime surfaces for a failed
execution goes through this, so a driver message or a piece of SQL cannot reach
a caller by taking a different path out.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypeAlias

CompiledQueryErrorCategory: TypeAlias = Literal[
    "input-invalid",
    "unauthenticated",
    "forbidden",
    "tenant-required",
    "not-found",
    "too-large",
    "aborted",
    "deadline-exceeded",
    "unavailable",
    "internal",
]

#: Categories whose cause is the server or a dependency. Their messages are
#: fixed here rather than taken from whatever raised, because adapter text is
#: exactly what must not reach a caller.
_SERVER_FAULT: frozenset[str] = frozenset(("unavailable", "internal"))

_SERVER_FAULT_MESSAGES = {
    "unavailable": "The query executor is unavailable.",
    "internal": "The query could not be executed.",
}


@dataclass(frozen=True, slots=True)
class CompiledQueryFailure:
    """The one shape a failed execution is reported in."""

    category: CompiledQueryErrorCategory
    message: str
    query_id: str | None = None

    def to_data(self) -> dict[str, object]:
        """Serialize for a transport boundary."""

        data: dict[str, object] = {"category": self.category, "message": self.message}
        if self.query_id is not None:
            data["queryId"] = self.query_id
        return data


class CompiledQueryError(Exception):
    """An execution failure carrying its public envelope.

    A server-fault category discards the message it was given: the caller sees
    a fixed sentence, and the detail belongs in a privileged diagnostic, never
    in the envelope.
    """

    __slots__ = ("failure",)

    def __init__(
        self,
        category: CompiledQueryErrorCategory,
        message: str,
        *,
        query_id: str | None = None,
    ) -> None:
        safe = _SERVER_FAULT_MESSAGES[category] if category in _SERVER_FAULT else message
        self.failure = CompiledQueryFailure(category=category, message=safe, query_id=query_id)
        super().__init__(f"{category}: {safe}")

    @property
    def category(self) -> CompiledQueryErrorCategory:
        return self.failure.category

    @property
    def message(self) -> str:
        return self.failure.message

    @property
    def query_id(self) -> str | None:
        return self.failure.query_id

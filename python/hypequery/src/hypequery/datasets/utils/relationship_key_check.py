"""Pure key-count decoding and cardinality findings."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class RelationshipKeyIssue:
    relationship: str
    kind: Literal["belongsTo", "hasOne"]
    target: str
    source: str
    column: str
    rows: int | str
    distinct_keys: int | str
    message: str
    columns: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CheckRelationshipsResult:
    ok: bool
    checked: tuple[str, ...]
    issues: tuple[RelationshipKeyIssue, ...]


def read_count(value: object) -> int:
    if type(value) is int and value >= 0:
        return value
    if type(value) is str and value and value.isascii() and value.isdigit():
        return int(value)
    raise ValueError("Expected a non-negative integer row count")


def display_count(value: int) -> int | str:
    return value if value <= 2**53 - 1 else str(value)

"""Stable ordering helpers shared by everything that hashes a projection.

Contract hashing and semantic cache keys both depend on these, so the ordering
rules live in one place rather than being restated at each call site. Sorting
is by UTF-16 code unit, matching the reference implementation, so a hash does
not depend on the host's locale or ICU version.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import TypeVar

T = TypeVar("T")


def _utf16_key(value: str) -> bytes:
    return value.encode("utf-16-be", "surrogatepass")


def sorted_record(entries: Mapping[str, T]) -> dict[str, T]:
    """Return a mapping whose keys are inserted in sorted order."""

    return {key: entries[key] for key in sorted(entries, key=_utf16_key)}


def unique_sorted(values: Iterable[str]) -> list[str]:
    """Deduplicate and sort, so logically equal sets serialize identically."""

    return sorted(set(values), key=_utf16_key)

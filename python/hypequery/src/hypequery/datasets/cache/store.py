"""Result stores: where cached rows live, addressed only by opaque keys.

A store never sees a preimage, a tenant identifier, or a filter value. It
receives RFC 0013 keys (`hq1.<version>.<namespace>.<mac>`) and the rows to
keep, so any store, including a shared remote one, is safe to inspect.
"""

from __future__ import annotations

import math
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    # Annotation-only: the client package imports this module at runtime.
    from ..client.results import ResultScalar


@dataclass(frozen=True, slots=True)
class CachedRows:
    """Immutable columns and rows, safe to hand to more than one caller."""

    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


class CacheStore(Protocol):
    """Anything that can keep rows under an opaque key for a while.

    Implementations may raise; the result cache treats any failure as a miss
    and never fails a query because a store did.
    """

    def get(self, key: str) -> CachedRows | None: ...

    def set(self, key: str, value: CachedRows, ttl_seconds: float) -> None: ...


class MemoryCacheStore:
    """A thread-safe, bounded, in-process LRU store with per-entry expiry."""

    __slots__ = ("_entries", "_lock", "_max_entries")

    def __init__(self, *, max_entries: int = 1_000) -> None:
        if type(max_entries) is not int or max_entries < 1:
            raise ValueError("max_entries must be a positive integer")
        self._max_entries = max_entries
        self._entries: OrderedDict[str, tuple[float, CachedRows]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> CachedRows | None:
        now = time.monotonic()
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            expires_at, value = entry
            if expires_at <= now:
                del self._entries[key]
                return None
            self._entries.move_to_end(key)
            return value

    def set(self, key: str, value: CachedRows, ttl_seconds: float) -> None:
        if not math.isfinite(ttl_seconds) or ttl_seconds <= 0:
            return
        with self._lock:
            self._entries[key] = (time.monotonic() + ttl_seconds, value)
            self._entries.move_to_end(key)
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._entries)


def create_memory_cache_store(*, max_entries: int = 1_000) -> MemoryCacheStore:
    """Create a bounded memory cache, matching TypeScript's factory name."""
    return MemoryCacheStore(max_entries=max_entries)

"""Per-route rate limiting, with TypeScript serve's semantics, and no framework.

A `RateLimit` is a fixed-window counter. The core runs a route's limits after
authentication and before the body is read, so a limited caller costs neither
a body parse nor a query. Exhaustion answers `429 RATE_LIMITED` with
`Retry-After` and `X-RateLimit-*`; a store failure lets the request through,
or with `fail_open=False` answers `503 SERVICE_UNAVAILABLE`.

The caller is the authenticated principal, or else the client address. That
address is the transport peer, or the nearest untrusted forwarded address when
`HttpSecurity(trusted_proxies=...)` is set, never a header the caller chose.
"""

from __future__ import annotations

import hashlib
import heapq
import math
import threading
import time
from collections.abc import Awaitable, Callable
from typing import Any, Protocol, runtime_checkable

from .auth import RequestAuth
from .errors import serve_error

DEFAULT_MESSAGE = "Too many requests, please try again later"

#: Picks the caller to count a request against, or None to leave it unlimited.
#: The request is the adapter's: a `ServeRequest` in the core, the framework's
#: own request in the FastAPI layer. Both carry `client` and `headers`.
RateLimitKey = Callable[[Any, RequestAuth | None], str | None]


@runtime_checkable
class RateLimitStore(Protocol):
    """Counts hits per key within a window."""

    def hit(self, key: str, window_seconds: int) -> Awaitable[tuple[int, float]]:
        """Count one hit; return the window's count and seconds until it resets."""
        ...


class RateLimitCapacityError(Exception):
    """The in-memory store cannot admit a key without losing an active window."""


class MemoryRateLimitStore:
    """A single-process store: a fixed window per key, bounded in size.

    When it is full, expired windows are dropped first. If every window is
    active, a new caller is refused rather than resetting another caller's
    counter.
    """

    def __init__(self, *, max_keys: int = 100_000) -> None:
        if type(max_keys) is not int or max_keys < 1:
            raise ValueError("max_keys must be a positive integer")
        self._max_keys = max_keys
        self._windows: dict[str, tuple[int, float]] = {}
        self._expirations: list[tuple[float, str]] = []
        self._lock = threading.Lock()

    async def hit(self, key: str, window_seconds: int) -> tuple[int, float]:
        now = time.monotonic()
        with self._lock:
            count, resets_at = self._windows.get(key, (0, 0.0))
            if resets_at <= now:
                self._windows.pop(key, None)
                count, resets_at = 0, now + window_seconds
                self._evict(now)
                if len(self._windows) >= self._max_keys:
                    raise RateLimitCapacityError("rate limit store is full")
                heapq.heappush(self._expirations, (resets_at, key))
            count += 1
            self._windows[key] = (count, resets_at)
            return count, resets_at - now

    def _evict(self, now: float) -> None:
        # A heap finds expired windows even when stores are shared by limits
        # with different durations, without scanning every key per new caller.
        while self._expirations and self._expirations[0][0] <= now:
            resets_at, key = heapq.heappop(self._expirations)
            current = self._windows.get(key)
            if current is not None and current[1] == resets_at:
                del self._windows[key]


def default_key(request: Any, auth: RequestAuth | None) -> str | None:
    """The principal if authenticated, else the client address."""

    if auth is not None:
        # A digest, so a shared store never holds subjects, which are often
        # email addresses. Length prefixes keep distinct (tenant, subject)
        # pairs unambiguous.
        tenant = auth.tenant.ids[0] if auth.tenant is not None else ""
        identity = f"{len(tenant)}:{tenant}{auth.principal.subject}"
        digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
        return f"principal:{digest[:32]}"
    # A `(host, port)` pair from either adapter: Starlette's address is one too.
    client = request.client
    return f"client:{client[0]}" if client is not None and client[0] else None


class RateLimit:
    """A fixed-window limit for one route. See the module docstring."""

    __slots__ = ("_fail_open", "_headers", "_key", "_max", "_message", "_store", "_window")

    def __init__(
        self,
        *,
        max: int = 100,  # noqa: A002 - TypeScript's option name
        window_seconds: int = 60,
        key: RateLimitKey | None = None,
        store: RateLimitStore | None = None,
        fail_open: bool = True,
        headers: bool = True,
        message: str = DEFAULT_MESSAGE,
    ) -> None:
        for label, value in (("max", max), ("window_seconds", window_seconds)):
            if type(value) is not int or value < 1:
                raise ValueError(f"RateLimit {label} must be a positive integer")
        if key is not None and not callable(key):
            raise TypeError("RateLimit key must be callable")
        if store is not None and not isinstance(store, RateLimitStore):
            raise TypeError("RateLimit store must implement hit(key, window_seconds)")
        self._max = max
        self._window = window_seconds
        self._key = key or default_key
        self._store = store or MemoryRateLimitStore()
        self._fail_open = fail_open
        self._headers = headers
        self._message = message

    @property
    def can_run_before_body(self) -> bool:
        """Whether the key needs only the route's already-established context."""

        return self._key is default_key

    async def check(self, request: Any, auth: RequestAuth | None, path: str) -> None:
        """Count *request* against this limit on *path*; raise when it is exhausted."""

        caller = self._key(request, auth)
        if caller is None:
            return
        try:
            count, resets_in = await self._store.hit(f"rl:{path}:{caller}", self._window)
        except RateLimitCapacityError as exc:
            raise serve_error(503, "SERVICE_UNAVAILABLE", "Rate limiter unavailable") from exc
        except Exception as exc:
            if self._fail_open:
                return
            raise serve_error(503, "SERVICE_UNAVAILABLE", "Rate limiter unavailable") from exc
        if count <= self._max:
            return
        retry_after = str(max(1, math.ceil(resets_in)))
        headers = {"Retry-After": retry_after}
        if self._headers:
            headers.update(
                {
                    "X-RateLimit-Limit": str(self._max),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": retry_after,
                }
            )
        raise serve_error(429, "RATE_LIMITED", self._message, headers=headers)

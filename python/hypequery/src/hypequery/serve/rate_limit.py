"""Per-route rate limiting, with TypeScript serve's semantics.

A `RateLimit` is a fixed-window counter, added to every route of an API with
``create_api(limits=[...])`` or to one route with ``limits=[...]``:

    add_dataset_endpoint(api, "/report", ..., limits=[RateLimit(max=10, window_seconds=60)])

A route runs its limits after authentication and before the body is read, so
a limited caller costs neither a body parse nor a query. Exhaustion answers
`429 RATE_LIMITED` with `Retry-After` and `X-RateLimit-*`; a store failure
lets the request through, or with `fail_open=False` answers
`503 SERVICE_UNAVAILABLE`. The limit itself is the core's (`core/rate_limit.py`).

The caller is the authenticated principal, or else the client address. That
address is the transport peer, or the nearest untrusted forwarded address when
`HttpSecurity(trusted_proxies=...)` is set, never a header the caller chose.
"""

from __future__ import annotations

from .core.rate_limit import (
    DEFAULT_MESSAGE,
    MemoryRateLimitStore,
    RateLimit,
    RateLimitCapacityError,
    RateLimitKey,
    RateLimitStore,
    default_key,
)

__all__ = [
    "DEFAULT_MESSAGE",
    "MemoryRateLimitStore",
    "RateLimit",
    "RateLimitCapacityError",
    "RateLimitKey",
    "RateLimitStore",
    "default_key",
]

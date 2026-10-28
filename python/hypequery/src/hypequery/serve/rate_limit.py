"""Per-route rate limiting, with TypeScript serve's semantics.

A `RateLimit` is a fixed window counter added to a route as a dependency:

    @router.get("/report", dependencies=[Depends(RateLimit(max=10, window_seconds=60))])

The limit itself is the core's (`core/rate_limit.py`); this module makes it a
FastAPI dependency. With the default key, the route runs it after
authentication and before the body is read, so a limited caller costs neither
a body parse nor a query. Custom keys run in FastAPI's dependency order, after
body parsing, so earlier dependencies can prepare the state they need. Limits
after a custom-key limit also keep that dependency order. Exhaustion answers
`429 RATE_LIMITED` with `Retry-After` and `X-RateLimit-*`; a store failure
lets the request through, or with `fail_open=False` answers
`503 SERVICE_UNAVAILABLE`.

The caller is the authenticated principal, or else the client address. That
address is the transport peer, or the nearest untrusted forwarded address when
`HttpSecurity(trusted_proxies=...)` is set, never a header the caller chose.
"""

# No `from __future__ import annotations`: `RateLimit` is a callable-instance
# dependency, and FastAPI 0.115 cannot resolve string annotations on one.
from collections.abc import Callable

from fastapi import Request

from .auth import RequestAuth
from .core import rate_limit as _core
from .core.rate_limit import (
    DEFAULT_MESSAGE,
    MemoryRateLimitStore,
    RateLimitCapacityError,
    RateLimitStore,
    default_key,
)
from .utils.scope_slot import ScopeSlot

__all__ = [
    "DEFAULT_MESSAGE",
    "MemoryRateLimitStore",
    "RateLimit",
    "RateLimitCapacityError",
    "RateLimitKey",
    "RateLimitStore",
    "default_key",
]

#: Picks the caller to count a request against, or None to leave it unlimited.
RateLimitKey = Callable[[Request, RequestAuth | None], str | None]

#: Which limits a request has already been counted against. Only this module
#: holds the slot.
_APPLIED_SLOT: "ScopeSlot[set[RateLimit]]" = ScopeSlot(set)


def _applied_limits(request: Request) -> "set[RateLimit]":
    return _APPLIED_SLOT.setdefault(request.scope, set)


class RateLimit(_core.RateLimit):
    """A fixed-window limit for one route. See the module docstring."""

    __slots__ = ()

    async def __call__(self, request: Request) -> None:
        # Imported here: the router imports this module to find limits.
        from .router import authenticated_context

        # A ServeRouter route applies its limits before reading the body and
        # FastAPI then resolves the same dependency again; count once.
        applied = _applied_limits(request)
        if self in applied:
            return
        applied.add(self)
        route = request.scope.get("route")
        path = getattr(route, "path", request.url.path)
        await self.check(request, authenticated_context(request), path)

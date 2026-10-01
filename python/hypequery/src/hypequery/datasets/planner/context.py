"""Execution context: tenant proof, deadline, cancellation, correlation.

Everything here is supplied by a trusted component. None of these types is a
Pydantic model, which is the point rather than an omission: a request body can
never be coerced into a `TenantScope`, so a caller cannot hand itself a tenant
or widen one it was given.

`TenantScope` is RFC 0009's tenant capability. It is opaque: only the
`tenant`, `tenants`, and `all_tenants` factories create one, it cannot be
pickled or copied into another shape, and its representation never shows a
tenant identifier, so a log line or traceback that prints a context leaks
nothing.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import NoReturn, Protocol, runtime_checkable

from .errors import CompiledQueryError

#: Held only by this module's factories. Constructing a `TenantScope` without
#: it fails, so a scope cannot be assembled from parts, however trusted the
#: code that tries.
_MINT = object()


class TenantScope:
    """Server-created proof of which tenants an execution may read.

    A cross-tenant scope is RFC 0009's trusted all-tenant execution: a job the
    runtime itself scopes to every tenant. Only `all_tenants()` produces one,
    so no request shape reaches it.
    """

    __slots__ = ("_cross_tenant", "_ids")

    _ids: tuple[str, ...]
    _cross_tenant: bool

    def __init__(self, mint: object, ids: tuple[str, ...], cross_tenant: bool) -> None:
        if mint is not _MINT:
            raise TypeError("a TenantScope is created by tenant(), tenants(), or all_tenants()")
        object.__setattr__(self, "_ids", ids)
        object.__setattr__(self, "_cross_tenant", cross_tenant)

    def __init_subclass__(cls, **kwargs: object) -> None:
        # A subclass could override __init__ and skip the mint check.
        raise TypeError("TenantScope cannot be subclassed")

    @property
    def ids(self) -> tuple[str, ...]:
        """The tenants an execution may read, in the order they were granted."""

        return self._ids

    @property
    def cross_tenant(self) -> bool:
        return self._cross_tenant

    def __setattr__(self, name: str, value: object) -> NoReturn:
        raise AttributeError("a TenantScope is immutable")

    def __delattr__(self, name: str) -> NoReturn:
        raise AttributeError("a TenantScope is immutable")

    def __reduce__(self) -> NoReturn:
        # Pickling would turn the capability into bytes that recreate it
        # anywhere, which is exactly the serialization RFC 0009 rules out.
        raise TypeError("a TenantScope cannot be serialized")

    def __getstate__(self) -> NoReturn:
        # Python 3.11+ gives every object a default that returns the slots,
        # which a serializer could call without going through pickle.
        raise TypeError("a TenantScope cannot be serialized")

    def __copy__(self) -> TenantScope:
        return self

    def __deepcopy__(self, memo: object) -> TenantScope:
        return self

    def __eq__(self, other: object) -> bool:
        # A tenant set is a set: granting ("a", "b") and ("b", "a") is the same
        # authority, as it is in the cache preimage.
        if not isinstance(other, TenantScope):
            return NotImplemented
        return self._cross_tenant == other._cross_tenant and frozenset(self._ids) == frozenset(
            other._ids
        )

    def __hash__(self) -> int:
        return hash((self._cross_tenant, frozenset(self._ids)))

    def __repr__(self) -> str:
        if self._cross_tenant:
            return "TenantScope(all tenants)"
        count = len(self._ids)
        return f"TenantScope({count} tenant{'' if count == 1 else 's'})"


def _checked_identifier(identifier: object) -> str:
    if type(identifier) is not str or not identifier:
        raise CompiledQueryError("internal", "a tenant identifier must be a non-empty string")
    return identifier


def tenant(identifier: str) -> TenantScope:
    """Scope an execution to one tenant."""

    return TenantScope(_MINT, (_checked_identifier(identifier),), False)


def tenants(identifiers: tuple[str, ...]) -> TenantScope:
    """Scope an execution to a fixed set of tenants."""

    if type(identifiers) is not tuple or not identifiers:
        # An empty set would render a predicate that matches nothing, which
        # reads as "no rows" rather than "no scope was resolved".
        raise CompiledQueryError("internal", "a tenant set must be a non-empty tuple")
    return TenantScope(_MINT, tuple(_checked_identifier(item) for item in identifiers), False)


def all_tenants() -> TenantScope:
    """Grant a trusted execution the runtime itself scopes to every tenant."""

    return TenantScope(_MINT, (), True)


@runtime_checkable
class Cancellation(Protocol):
    """What the planner needs of a cancellation signal.

    `threading.Event` and `asyncio.Event` both satisfy it. Propagating a
    cancellation to the driver is PYC-02's; here it decides only whether an
    execution should be built at all.
    """

    def is_set(self) -> bool: ...


@dataclass(frozen=True, slots=True)
class Deadline:
    """An absolute point on the monotonic clock."""

    monotonic_at: float

    @staticmethod
    def after(seconds: float) -> Deadline:
        """A deadline *seconds* from now."""

        return Deadline(monotonic_at=time.monotonic() + seconds)

    def remaining(self) -> float:
        """Seconds left, negative once expired."""

        return self.monotonic_at - time.monotonic()

    def expired(self) -> bool:
        return self.remaining() <= 0


def effective_deadline(caller: Deadline | None, policy_seconds: int) -> Deadline:
    """The earlier of the caller's deadline and the policy ceiling.

    A caller can shorten the window and never extend it, so the ceiling applies
    whether or not one was supplied.
    """

    ceiling = Deadline.after(policy_seconds)
    if caller is None:
        return ceiling
    return caller if caller.monotonic_at < ceiling.monotonic_at else ceiling


@dataclass(frozen=True, slots=True)
class ExecutionContext:
    """What a trusted caller supplies alongside a semantic query."""

    tenant: TenantScope | None = None
    deadline: Deadline | None = None
    cancellation: Cancellation | None = None
    correlation_id: str | None = None

    def __post_init__(self) -> None:
        # The annotation is not enforced at runtime, so a mapping decoded from a
        # request could otherwise sit where a capability belongs.
        if self.tenant is not None and type(self.tenant) is not TenantScope:
            raise CompiledQueryError(
                "forbidden",
                "The execution context does not carry a tenant capability.",
                code="HQ_CAPABILITY_CLASS_MISMATCH",
            )

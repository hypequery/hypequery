"""Execution context: tenant proof, deadline, cancellation, correlation.

Everything here is supplied by a trusted component. None of these types is a
Pydantic model, which is the point rather than an omission: a request body can
never be coerced into a `TenantScope`, so a caller cannot hand itself a tenant
or widen one it was given. The full capability model is RFC 0009's; this is the
part the planner needs to put a tenant predicate into SQL.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from .errors import CompiledQueryError


@dataclass(frozen=True, slots=True)
class TenantScope:
    """Server-created proof of which tenants an execution may read.

    `cross_tenant` is deliberately not expressible as data: it is set by the
    `all_tenants()` factory and nothing else, so no request shape reaches it.
    """

    ids: tuple[str, ...] = ()
    cross_tenant: bool = False


def tenant(identifier: str) -> TenantScope:
    """Scope an execution to one tenant."""

    if type(identifier) is not str or not identifier:
        raise CompiledQueryError("internal", "a tenant identifier must be a non-empty string")
    return TenantScope(ids=(identifier,))


def tenants(identifiers: tuple[str, ...]) -> TenantScope:
    """Scope an execution to a fixed set of tenants."""

    if not identifiers:
        # An empty set would render a predicate that matches nothing, which
        # reads as "no rows" rather than "no scope was resolved".
        raise CompiledQueryError("internal", "a tenant set must name at least one tenant")
    for identifier in identifiers:
        if type(identifier) is not str or not identifier:
            raise CompiledQueryError("internal", "a tenant identifier must be a non-empty string")
    return TenantScope(ids=tuple(identifiers))


def all_tenants() -> TenantScope:
    """Grant an administrative execution that crosses tenants."""

    return TenantScope(cross_tenant=True)


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

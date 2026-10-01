"""Validate and apply a single-tenant capability for request-bound clients."""

from __future__ import annotations

from dataclasses import replace

from ..planner import CompiledQueryError, ExecutionContext, TenantScope


def require_tenant_capability(scope: object) -> TenantScope:
    """Admit only one named tenant for a request-bound client."""

    if scope is None:
        raise CompiledQueryError(
            "forbidden", "No tenant capability was presented.", code="HQ_CAPABILITY_MISSING"
        )
    if type(scope) is not TenantScope or scope.cross_tenant or len(scope.ids) != 1:
        raise CompiledQueryError(
            "forbidden",
            "A tenant-bound client requires a single-tenant capability.",
            code="HQ_CAPABILITY_CLASS_MISMATCH",
        )
    return scope


def bind_tenant(scope: TenantScope, context: ExecutionContext | None) -> ExecutionContext:
    """Return a context carrying the client's scope, refusing a different one."""

    if context is None:
        return ExecutionContext(tenant=scope)
    if context.tenant is not None and context.tenant != scope:
        raise CompiledQueryError(
            "forbidden",
            "The execution context names a different tenant than the client is bound to.",
            code="HQ_CAPABILITY_TENANT_MISMATCH",
        )
    return replace(context, tenant=scope)

"""Dataset query limits, reserved names and tenant capability validation.

These checks do not allocate parameters or build SQL. Field-specific checks
remain alongside name resolution in the compiler to preserve rejection order.
"""

from __future__ import annotations

from ..dataset import Dataset
from .aliases import BASE_ALIAS
from .context import ExecutionContext, TenantScope
from .errors import CompiledQueryError
from .query import DatasetQuery


def resolve_tenant_scope(dataset: Dataset, context: ExecutionContext) -> TenantScope | None:
    """The scope to enforce on *dataset*, refusing to serve it unscoped.

    A dataset declaring a tenant key is one whose rows belong to someone. Read
    without proof, every row is returned, so an absent scope fails closed here
    rather than at whatever reads the result.
    """

    if dataset.tenant_key is None:
        return None
    scope = context.tenant
    if scope is None:
        raise CompiledQueryError(
            "tenant-required",
            f'Dataset "{dataset.name}" requires runtime tenant scoping.',
            code="HQ_CAPABILITY_TENANT_REQUIRED",
        )
    if type(scope) is not TenantScope:
        # ExecutionContext checks this on construction, but object.__new__
        # skips that. A look-alike claiming cross_tenant must not drop the
        # predicate.
        raise CompiledQueryError(
            "forbidden",
            "The execution context does not carry a tenant capability.",
            code="HQ_CAPABILITY_CLASS_MISMATCH",
        )
    return None if scope.cross_tenant else scope


def check_query_limits(dataset: Dataset, query: DatasetQuery) -> None:
    limits = dataset.limits
    if limits is None:
        return
    if limits.max_dimensions is not None and len(query.dimensions) > limits.max_dimensions:
        raise CompiledQueryError(
            "too-large",
            f"Too many dimensions: {len(query.dimensions)} (max {limits.max_dimensions})",
        )
    measures = query.measures if query.measures is not None else tuple(dataset.measures)
    if limits.max_measures is not None and len(measures) > limits.max_measures:
        raise CompiledQueryError(
            "too-large", f"Too many measures: {len(measures)} (max {limits.max_measures})"
        )
    if limits.max_filters is not None and len(query.having) > limits.max_filters:
        raise CompiledQueryError(
            "too-large",
            f"Too many having conditions: {len(query.having)} (max {limits.max_filters})",
        )
    if limits.max_filters is not None and len(query.filters) > limits.max_filters:
        raise CompiledQueryError(
            "too-large", f"Too many filters: {len(query.filters)} (max {limits.max_filters})"
        )
    if (
        limits.max_result_size is not None
        and query.limit is not None
        and query.limit > limits.max_result_size
    ):
        raise CompiledQueryError(
            "too-large",
            f"Too many results requested: {query.limit} (max {limits.max_result_size})",
        )


def check_reserved_alias(dataset: Dataset) -> None:
    """Refuse a dataset whose own names would shadow the base alias."""

    for names in (dataset.dimensions, dataset.measures, dataset.relationships):
        if BASE_ALIAS.name in names:
            raise CompiledQueryError(
                "internal",
                f'Dataset "{dataset.name}" declares the reserved name "{BASE_ALIAS.name}".',
            )

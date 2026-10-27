"""Turn what a host's tenant function returns into a request's client.

A tenant function returns a tenant id, a ``TenantScope`` it built itself, or
None for a request that has no tenant. None yields the unscoped client, which
is safe to hand out: a dataset with a ``tenant_key`` refuses to run without a
tenant, so only tenant-free datasets answer it.
"""

from __future__ import annotations

from typing import TypeAlias, overload

from ...datasets import (
    AsyncDatasetClient,
    AsyncTenantDatasetClient,
    DatasetClient,
    TenantDatasetClient,
)
from ...datasets.planner import TenantScope, tenant

TenantValue: TypeAlias = str | TenantScope | None


def _scope(value: TenantValue) -> TenantScope | None:
    if value is None or isinstance(value, TenantScope):
        return value
    if isinstance(value, str):
        return tenant(value)
    raise TypeError("a tenant function must return a tenant id, a TenantScope, or None")


@overload
def bind_tenant_value(
    client: DatasetClient, value: TenantValue
) -> DatasetClient | TenantDatasetClient: ...
@overload
def bind_tenant_value(
    client: AsyncDatasetClient, value: TenantValue
) -> AsyncDatasetClient | AsyncTenantDatasetClient: ...
def bind_tenant_value(
    client: DatasetClient | AsyncDatasetClient, value: TenantValue
) -> DatasetClient | TenantDatasetClient | AsyncDatasetClient | AsyncTenantDatasetClient:
    """*client* bound to *value*'s tenant, or *client* itself for no tenant."""

    scope = _scope(value)
    return client if scope is None else client.for_tenant(scope)

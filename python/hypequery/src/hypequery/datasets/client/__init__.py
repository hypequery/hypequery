"""Dataset clients: the canonical way to run a semantic query."""

from __future__ import annotations

from .clients import (
    AsyncDatasetClient,
    AsyncTenantDatasetClient,
    DatasetClient,
    ExecuteOptions,
    TenantDatasetClient,
    create_async_dataset_client,
    create_dataset_client,
)
from .inputs import DatasetTarget, QueryInput
from .pagination import DEFAULT_PAGE_SIZE
from .results import (
    AsyncQueryExecutor,
    CacheStatus,
    DatasetQueryMeta,
    DatasetQueryResult,
    Pagination,
    QueryExecutor,
    ResultRows,
    ResultScalar,
    ValidationResult,
)

__all__ = [
    "DEFAULT_PAGE_SIZE",
    "AsyncDatasetClient",
    "AsyncQueryExecutor",
    "AsyncTenantDatasetClient",
    "CacheStatus",
    "DatasetClient",
    "DatasetQueryMeta",
    "DatasetQueryResult",
    "DatasetTarget",
    "ExecuteOptions",
    "Pagination",
    "QueryExecutor",
    "QueryInput",
    "ResultRows",
    "ResultScalar",
    "TenantDatasetClient",
    "ValidationResult",
    "create_async_dataset_client",
    "create_dataset_client",
]

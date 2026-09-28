"""Dataset clients: the canonical way to run a semantic query."""

from __future__ import annotations

from .clients import (
    AsyncDatasetClient,
    DatasetClient,
    create_async_dataset_client,
    create_dataset_client,
)
from .inputs import DatasetTarget, QueryInput
from .results import (
    AsyncQueryExecutor,
    CacheStatus,
    DatasetQueryMeta,
    DatasetQueryResult,
    QueryExecutor,
    ResultRows,
    ResultScalar,
    ValidationResult,
)

__all__ = [
    "AsyncDatasetClient",
    "AsyncQueryExecutor",
    "CacheStatus",
    "DatasetClient",
    "DatasetQueryMeta",
    "DatasetQueryResult",
    "DatasetTarget",
    "QueryExecutor",
    "QueryInput",
    "ResultRows",
    "ResultScalar",
    "ValidationResult",
    "create_async_dataset_client",
    "create_dataset_client",
]

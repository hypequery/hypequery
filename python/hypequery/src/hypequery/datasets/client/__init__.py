"""Dataset clients: the canonical way to run a semantic query."""

from __future__ import annotations

from ..utils.output_column_types import ResultColumnType
from .clients import (
    AsyncDatasetClient,
    AsyncTenantDatasetClient,
    DatasetClient,
    ExecuteOptions,
    TenantDatasetClient,
    create_async_dataset_client,
    create_dataset_client,
)
from .dataframes import DecimalMode
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
from .streams import (
    ArrowBatchStream,
    AsyncArrowBatchStream,
    AsyncDatasetArrowStream,
    AsyncDatasetRowStream,
    AsyncRowBatchStream,
    AsyncStreamingQueryExecutor,
    DatasetArrowStream,
    DatasetRowStream,
    RowBatch,
    RowBatchStream,
    StreamingQueryExecutor,
)

__all__ = [
    "DEFAULT_PAGE_SIZE",
    "ArrowBatchStream",
    "AsyncArrowBatchStream",
    "AsyncDatasetArrowStream",
    "AsyncDatasetClient",
    "AsyncDatasetRowStream",
    "AsyncQueryExecutor",
    "AsyncRowBatchStream",
    "AsyncStreamingQueryExecutor",
    "AsyncTenantDatasetClient",
    "CacheStatus",
    "DatasetArrowStream",
    "DatasetClient",
    "DatasetQueryMeta",
    "DatasetQueryResult",
    "DatasetRowStream",
    "DatasetTarget",
    "DecimalMode",
    "ExecuteOptions",
    "Pagination",
    "QueryExecutor",
    "QueryInput",
    "ResultColumnType",
    "ResultRows",
    "ResultScalar",
    "RowBatch",
    "RowBatchStream",
    "StreamingQueryExecutor",
    "TenantDatasetClient",
    "ValidationResult",
    "create_async_dataset_client",
    "create_dataset_client",
]

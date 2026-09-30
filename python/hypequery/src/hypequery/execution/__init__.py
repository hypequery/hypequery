"""ClickHouse execution for compiled dataset queries.

Importing this module does not import the optional driver or open a connection.
Install ``hypequery[clickhouse]`` or ``hypequery[clickhouse-async]`` to use it.
"""

from .clickhouse import (
    AsyncClickHouseExecutor,
    AsyncFromSyncClickHouseExecutor,
    ClickHouseConnection,
    ClickHouseExecutor,
    create_async_clickhouse_executor,
    create_clickhouse_executor,
)
from .readonly_settings import ReadonlyPolicy
from .results import QueryRows

__all__ = [
    "AsyncClickHouseExecutor",
    "AsyncFromSyncClickHouseExecutor",
    "ClickHouseConnection",
    "ClickHouseExecutor",
    "QueryRows",
    "ReadonlyPolicy",
    "create_async_clickhouse_executor",
    "create_clickhouse_executor",
]

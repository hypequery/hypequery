"""ClickHouse execution for compiled dataset queries.

Importing this module does not import the optional driver or open a connection.
Install ``hypequery[clickhouse]`` or ``hypequery[clickhouse-async]`` to use a
ClickHouse server, or ``hypequery[chdb]`` for embedded ClickHouse.
"""

from .chdb import (
    AsyncChdbExecutor,
    ChdbExecutor,
    create_async_chdb_executor,
    create_chdb_executor,
)
from .clickhouse import (
    AsyncClickHouseExecutor,
    AsyncFromSyncClickHouseExecutor,
    ClickHouseConnection,
    ClickHouseExecutor,
    create_async_clickhouse_executor,
    create_async_from_sync_clickhouse_executor,
    create_clickhouse_executor,
)
from .readonly_settings import ReadonlyPolicy
from .results import QueryRows

__all__ = [
    "AsyncChdbExecutor",
    "AsyncClickHouseExecutor",
    "AsyncFromSyncClickHouseExecutor",
    "ChdbExecutor",
    "ClickHouseConnection",
    "ClickHouseExecutor",
    "QueryRows",
    "ReadonlyPolicy",
    "create_async_chdb_executor",
    "create_async_clickhouse_executor",
    "create_async_from_sync_clickhouse_executor",
    "create_chdb_executor",
    "create_clickhouse_executor",
]

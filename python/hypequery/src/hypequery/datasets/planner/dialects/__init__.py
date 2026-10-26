"""SQL dialects: the spelling of each construct the planner compiles."""

from __future__ import annotations

from .base import Aggregate, SqlDialect
from .clickhouse import CLICKHOUSE, ClickHouseDialect
from .postgres import POSTGRES, PostgresDialect

__all__ = [
    "CLICKHOUSE",
    "POSTGRES",
    "Aggregate",
    "ClickHouseDialect",
    "PostgresDialect",
    "SqlDialect",
]

"""SQL dialects: the spelling of each construct the planner compiles."""

from __future__ import annotations

from .base import SqlDialect
from .clickhouse import CLICKHOUSE, ClickHouseDialect

__all__ = ["CLICKHOUSE", "ClickHouseDialect", "SqlDialect"]

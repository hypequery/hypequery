"""Server-owned environment configuration; no connection at import time."""

import os

from hypequery.execution import ClickHouseConnection


def required_environment(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ValueError(f"Set {name} before starting the example")
    return value


def connection() -> ClickHouseConnection:
    return ClickHouseConnection(
        host=os.environ.get("CLICKHOUSE_HOST", "localhost"),
        port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
        database=os.environ.get("CLICKHOUSE_DATABASE", "default"),
        username=os.environ.get("CLICKHOUSE_USERNAME", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
    )

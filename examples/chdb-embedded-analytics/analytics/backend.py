"""One switch between embedded and server ClickHouse. The datasets, the CLI
and the HTTP API never change; only the executor does."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit

from hypequery.datasets import DatasetClient, create_dataset_client, create_dataset_registry
from hypequery.execution import (
    ChdbExecutor,
    ClickHouseConnection,
    ClickHouseExecutor,
    create_chdb_executor,
    create_clickhouse_executor,
)

from analytics.datasets import events, tenants

DEFAULT_CHDB_PATH = str(Path(__file__).resolve().parent.parent / "analytics.chdb")


def backend_name() -> str:
    return os.environ.get("ANALYTICS_BACKEND", "chdb")


def connection_from_env() -> ClickHouseConnection:
    """The CLICKHOUSE_* variables every example in this repository shares."""

    url = urlsplit(os.environ.get("CLICKHOUSE_URL", "http://localhost:8123"))
    return ClickHouseConnection(
        host=url.hostname or "localhost",
        port=url.port or (8443 if url.scheme == "https" else 8123),
        secure=url.scheme == "https",
        database=os.environ.get("CLICKHOUSE_DATABASE", "hypequery_examples"),
        username=os.environ.get("CLICKHOUSE_USERNAME", url.username or "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", url.password or "hypequery"),
    )


def open_executor(backend: str | None = None) -> ChdbExecutor | ClickHouseExecutor:
    if (backend or backend_name()) == "clickhouse":
        return create_clickhouse_executor(connection_from_env())
    # chDB: the engine runs in this process, on a directory next to the code.
    from analytics.sample_data import ensure_sample_data

    path = os.environ.get("CHDB_PATH", DEFAULT_CHDB_PATH)
    ensure_sample_data(path)
    return create_chdb_executor(path)


def open_client(executor: ChdbExecutor | ClickHouseExecutor) -> DatasetClient:
    # The registry resolves the `tenant` relationship for `tenant.plan` queries.
    return create_dataset_client(executor=executor, registry=create_dataset_registry(events, tenants))

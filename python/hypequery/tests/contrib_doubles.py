"""Shared doubles for the framework integration tests: a dataset and executors.

The integrations build their executors through two factories in
``hypequery.contrib.utils.process_clients``; :func:`install_executors` swaps
both for recording doubles so no test needs a ClickHouse server.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from hypequery.contrib.utils import process_clients
from hypequery.datasets import CompiledQuery, Dataset, create_dataset_registry, dimension, measure
from hypequery.execution import ClickHouseConnection, QueryRows

ORDERS = Dataset(
    name="orders",
    source="orders",
    tenant_key="org_id",
    dimensions={"status": dimension("string")},
    measures={"orders": measure.count("id")},
)
OPEN = Dataset(
    name="open_stats",
    source="open_stats",
    dimensions={"status": dimension("string")},
    measures={"orders": measure.count("id")},
)
REGISTRY = create_dataset_registry(ORDERS, OPEN)
ROWS = QueryRows(("status", "orders"), (("paid", 3),))


@dataclass
class SyncExecutor:
    connection: ClickHouseConnection
    seen: list[CompiledQuery] = field(default_factory=list)
    closed: int = 0

    def execute(self, compiled: CompiledQuery) -> QueryRows:
        self.seen.append(compiled)
        return ROWS

    def close(self) -> None:
        self.closed += 1


@dataclass
class AsyncExecutor(SyncExecutor):
    max_concurrent: int = 0

    async def execute(self, compiled: CompiledQuery) -> QueryRows:  # type: ignore[override]
        self.seen.append(compiled)
        return ROWS


@dataclass
class Built:
    sync: list[SyncExecutor] = field(default_factory=list)
    async_: list[AsyncExecutor] = field(default_factory=list)

    def tenants(self) -> list[object]:
        """The bound parameter values of every query run, sync and async."""

        return [
            value
            for executor in (*self.sync, *self.async_)
            for compiled in executor.seen
            for value in compiled.parameter_values().values()
        ]


def query(client: Any) -> None:
    """Run one tenant-free query, which is what makes a lazy client connect."""

    client.execute("open_stats", {"dimensions": ["status"]})


def install_executors(monkeypatch: pytest.MonkeyPatch) -> Built:
    built = Built()

    def sync_factory(connection: ClickHouseConnection) -> SyncExecutor:
        built.sync.append(SyncExecutor(connection))
        return built.sync[-1]

    def async_factory(connection: ClickHouseConnection, *, max_concurrent: int) -> AsyncExecutor:
        built.async_.append(AsyncExecutor(connection, max_concurrent=max_concurrent))
        return built.async_[-1]

    monkeypatch.setattr(process_clients, "create_clickhouse_executor", sync_factory)
    monkeypatch.setattr(
        process_clients, "create_async_from_sync_clickhouse_executor", async_factory
    )
    return built

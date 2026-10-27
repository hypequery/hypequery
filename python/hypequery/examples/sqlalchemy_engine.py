"""Run: python -m examples.sqlalchemy_engine URL (from python/hypequery).

Needs ``hypequery[clickhouse]`` and SQLAlchemy. URL is a SQLAlchemy URL for
ClickHouse's HTTP interface, e.g. ``clickhousedb://default:pw@localhost:8123/db``.
Seed examples/seed.sql into that database first.

An app that already talks to ClickHouse through SQLAlchemy keeps its engine for
its own SQL and points hypequery at the same server for governed, tenant-scoped
metrics. hypequery opens its own HTTP clients from the engine's URL; it never
borrows a connection from the engine's pool.
"""

from __future__ import annotations

import sys
from typing import Any

from sqlalchemy import create_engine, text

from hypequery.contrib.sqlalchemy import executor_from_engine
from hypequery.datasets import create_dataset_client, tenant

from .utils.orders import orders, registry


def compare(url: str, organization: str = "a") -> dict[str, Any]:
    """The same total through raw SQLAlchemy SQL and through the dataset."""

    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            raw = connection.execute(
                text("SELECT sum(amount) FROM example_orders WHERE org_id = :org"),
                {"org": organization},
            ).scalar()
        with executor_from_engine(engine) as executor:
            client = create_dataset_client(executor=executor, registry=registry)
            result = client.for_tenant(tenant(organization)).execute(
                orders, {"measures": ["revenue"]}
            )
    finally:
        engine.dispose()
    return {"sqlalchemy": raw, "hypequery": result.data[0]["revenue"]}


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: python -m examples.sqlalchemy_engine clickhousedb://...")
    print(compare(sys.argv[1]))

"""Run: python -m examples.dataframes (from python/hypequery).

Needs ``hypequery[clickhouse,pandas]``. Seed examples/seed.sql and set
CLICKHOUSE_URL (or the CLICKHOUSE_* variables). Prints organization a's daily
revenue as a typed pandas DataFrame.
"""

from __future__ import annotations

from typing import Any

from hypequery.datasets import create_dataset_client, tenant
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

from .utils.orders import orders, registry


def daily_revenue(organization: str = "a") -> Any:
    """One organization's revenue per day, as a pandas DataFrame."""

    with create_clickhouse_executor(ClickHouseConnection.from_env()) as executor:
        client = create_dataset_client(executor=executor, registry=registry)
        result = client.for_tenant(tenant(organization)).execute(
            orders, {"measures": ["revenue", "orderCount"], "by": "day"}
        )
    # period: datetime64[us, UTC], revenue: float64, orderCount: Int64.
    return result.to_pandas()


if __name__ == "__main__":
    frame = daily_revenue()
    print(frame.dtypes, frame, sep="\n\n")
    print("\nTotal revenue:", frame["revenue"].sum())

"""Dashboard queries: each one is a semantic query against a dataset, returned
as a pandas DataFrame. Filters map to dataset fields; the tenant scope is an
explicit execution context, never a WHERE clause the page writes."""

from __future__ import annotations

import atexit
from dataclasses import dataclass
from datetime import date
from functools import cache
from typing import Any

import pandas as pd
from hypequery.datasets import (
    DatasetClient,
    ExecutionContext,
    all_tenants,
    create_dataset_client,
    create_dataset_registry,
    tenant,
)
from hypequery.execution import create_clickhouse_executor

from analytics.connection import connection_from_env
from analytics.datasets import events, tenants

GRAINS = ("day", "week", "month")
KPI_MEASURES = ["events", "active_users", "error_rate", "p95_latency_ms"]


@dataclass(frozen=True)
class Filters:
    start: date
    end: date
    tenant_id: int | None = None  # None: every tenant (an internal dashboard)
    plans: tuple[str, ...] = ()
    devices: tuple[str, ...] = ()

    def context(self) -> ExecutionContext:
        scope = all_tenants() if self.tenant_id is None else tenant(str(self.tenant_id))
        return ExecutionContext(tenant=scope)

    def to_query(self) -> list[dict[str, Any]]:
        period = [f"{self.start} 00:00:00", f"{self.end} 23:59:59"]
        filters: list[dict[str, Any]] = [{"field": "occurred_at", "operator": "between", "value": period}]
        if self.plans:
            filters.append({"field": "tenant.plan", "operator": "in", "value": list(self.plans)})
        if self.devices:
            filters.append({"field": "device", "operator": "in", "value": list(self.devices)})
        return filters


@cache
def client() -> DatasetClient:
    """One executor per process; Streamlit reruns the page, not the module."""
    executor = create_clickhouse_executor(connection_from_env())
    atexit.register(executor.close)
    return create_dataset_client(executor=executor, registry=create_dataset_registry(events, tenants))


def kpis(f: Filters) -> dict[str, Any]:
    result = client().execute(events, {"measures": KPI_MEASURES, "filters": f.to_query()}, context=f.context())
    return dict(result.data[0])


def timeseries(f: Filters, grain: str = "day") -> pd.DataFrame:
    if grain not in GRAINS:
        raise ValueError(f"grain must be one of {GRAINS}")
    query = {"measures": ["events", "active_users", "error_rate"], "by": grain, "filters": f.to_query()}
    return client().execute(events, query, context=f.context()).to_pandas()


def breakdown(f: Filters, dimension: str, limit: int = 10) -> pd.DataFrame:
    """Events and error rate per value of any events dimension, e.g. "device" or "tenant.plan"."""
    query = {
        "dimensions": [dimension],
        "measures": ["events", "active_users", "error_rate"],
        "filters": f.to_query(),
        "order_by": [{"field": "events", "direction": "desc"}],
        "limit": limit,
    }
    return client().execute(events, query, context=f.context()).to_pandas()


def options(dimension: str) -> list[str]:
    """Filter choices come from the data too: distinct plans or devices."""
    target = tenants if dimension == "plan" else events
    measure = "tenants" if dimension == "plan" else "events"
    query = {"dimensions": [dimension], "measures": [measure], "order_by": [{"field": dimension, "direction": "asc"}]}
    return [row[dimension] for row in client().execute(target, query, context=ExecutionContext(tenant=all_tenants())).data]


def tenant_names() -> dict[int, str]:
    query = {"dimensions": ["tenant_id", "name"], "measures": ["tenants"], "order_by": [{"field": "name", "direction": "asc"}]}
    rows = client().execute(tenants, query, context=ExecutionContext(tenant=all_tenants())).data
    return {int(row["tenant_id"]): row["name"] for row in rows}

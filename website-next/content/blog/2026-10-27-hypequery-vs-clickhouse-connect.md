---
title: "hypequery vs clickhouse-connect: Driver or Semantic Layer?"
description: "clickhouse-connect runs the SQL you write. hypequery runs on top of it and adds shared measures, validation, and tenant isolation. Here is when you need each in Python."
seoTitle: "hypequery vs clickhouse-connect — ClickHouse in Python"
seoDescription: "Compare clickhouse-connect, the official ClickHouse Python driver, with hypequery, a Python semantic layer built on it. When to use the driver, when to add the layer, and how they share a connection."
pubDate: 2026-10-27
heroImage: ""
slug: hypequery-vs-clickhouse-connect
status: published
---

clickhouse-connect is the official ClickHouse driver for Python. It sends SQL over HTTP, binds parameters on the server, and hands results back as Python values, NumPy arrays, pandas DataFrames, or Arrow tables. It also does fast bulk inserts. If you run ClickHouse from Python, you probably already use it.

hypequery is not a different driver. Its Python package runs on clickhouse-connect. What it adds sits above the driver: a definition of what your numbers mean, and rules about who may ask for them.

So this isn't really a choice between two tools. The question is whether your analytics SQL needs a layer on top.

## What clickhouse-connect gives you

- **Any SQL you can write.** Queries, DDL, inserts, settings, and system tables.
- **Server-side parameters.** Values are bound by ClickHouse, not interpolated into strings.
- **Data-science output.** `query_df` and `query_arrow` return DataFrames and Arrow tables directly.
- **Bulk inserts.** Columnar inserts and async inserts for ingestion.

It does not know what "revenue" means, which customer a request belongs to, or which fields a caller should be allowed to group by. That knowledge lives in your SQL strings.

## What hypequery adds

You describe a dataset once: its table, dimensions, measures, time column, and tenant key.

```python
from hypequery.datasets import Dataset, dimension, measure

orders = Dataset(
    name="orders",
    source="orders",
    tenant_key="org_id",
    time_key="created_at",
    dimensions={"status": dimension("string"), "country": dimension("string")},
    measures={"revenue": measure.sum("amount"), "order_count": measure.count("order_id")},
)
```

Callers then ask for measures by name:

```python
from hypequery.datasets import tenant

result = analytics.for_tenant(tenant("org_123")).execute(
    "orders", {"dimensions": ["country"], "measures": ["revenue"]}
)
```

hypequery plans the SQL, rejects fields the dataset doesn't declare, and adds the tenant filter. A query without a tenant fails instead of reading every customer. The same dataset can be served from FastAPI, consumed by generated React hooks, and exposed to AI agents through the MCP bridge.

## Where each one fits

Use **clickhouse-connect directly** for:

- inserts and ingestion
- schema changes and admin scripts
- one-off analysis where `query_df` on arbitrary SQL is exactly what you want

Use **hypequery** when:

- the same measure is queried from several places: an API, a job, a notebook, a dashboard
- customers see the results, so tenant isolation can't depend on each query remembering a filter
- you want HTTP endpoints, typed frontend hooks, or agent access without writing them by hand

## Trade-offs to know

hypequery returns rows as dictionaries, with decimals, dates, and timestamps as strings so nothing loses precision. That's the right default for APIs, but in a notebook you'll convert columns yourself, where `query_df` would hand you typed columns straight away.

hypequery is read-only. Inserts stay with the driver.

## Using both

They can share one client. `ClickHouseExecutor` accepts an existing clickhouse-connect client:

```python
import clickhouse_connect
from hypequery.datasets import create_dataset_client
from hypequery.execution import ClickHouseExecutor

from analytics.datasets import registry

client = clickhouse_connect.get_client(host="localhost", username="default", password="")
analytics = create_dataset_client(executor=ClickHouseExecutor(client), registry=registry)
```

Most teams end up with both: the driver for writing and exploring, hypequery for the numbers they share.

# hypequery for Python

**A code-first semantic layer for ClickHouse.** Define dimensions, measures and
tenant rules once in Python, query them by name, serve them from FastAPI, Django
or Flask, and reuse the same definitions from React and AI agents.

[![PyPI](https://img.shields.io/pypi/v/hypequery.svg)](https://pypi.org/project/hypequery/)
[![Python versions](https://img.shields.io/pypi/pyversions/hypequery.svg)](https://pypi.org/project/hypequery/)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](https://github.com/hypequery/hypequery/blob/main/LICENSE)
[![Docs](https://img.shields.io/badge/docs-hypequery.com-0a7cff.svg)](https://hypequery.com/docs/python)

- **No metrics service.** It is a library. Definitions live in your codebase
  and queries run in your process, on your ClickHouse.
- **Typed, validated queries.** Requests are checked against the dataset before
  any SQL is generated, and the SQL is parameterized.
- **Multi-tenant by default.** Declare `tenant_key` once and every query is
  scoped to the caller's tenant.
- **One definition, every surface.** Rows, pandas, polars or Arrow in Python;
  authenticated HTTP endpoints; generated React hooks; governed MCP tools for
  agents.

## Install

```bash
pip install "hypequery[clickhouse]"
```

Python 3.11 or later. Extras: `clickhouse-async`, `server`, `jwt`, `django`,
`flask`, `pandas`, `polars`, `arrow`.

## Define a dataset and query it

```python
from hypequery.datasets import (
    DatasetQuery,
    ExecutionContext,
    create_dataset_client,
    dataset,
    dimension,
    filter,
    measure,
    order,
    tenant,
)
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

orders = dataset(
    "orders",
    source="orders",
    tenant_key="tenant_id",
    time_key="created_at",
    dimensions={
        "country": dimension.string(),
        "status": dimension.string(),
        "createdAt": dimension.timestamp(column="created_at"),
    },
    measures={
        "revenue": measure.sum("amount"),
        "orderCount": measure.count("id"),
    },
)

analytics = create_dataset_client(
    executor=create_clickhouse_executor(ClickHouseConnection.from_env()),
)

result = analytics.execute(
    orders,
    DatasetQuery(
        dimensions=("country",),
        measures=("revenue", "orderCount"),
        filters=(filter.eq("status", "paid"),),
        order_by=(order.desc("revenue"),),
        limit=10,
    ),
    context=ExecutionContext(tenant=tenant("org_123")),
)
print(result.data)
```

`ClickHouseConnection.from_env()` reads `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`,
`CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME` and `CLICKHOUSE_PASSWORD`, or a
single `CLICKHOUSE_URL`. Already have tables? `hypequery init` introspects your
schema and writes the dataset definitions for you.

## Serve it over HTTP

The API is plain ASGI, so it mounts in FastAPI, Starlette or any ASGI app, and
is served natively from Django and Flask. Every endpoint authenticates before
reading the body and takes the tenant from the caller.

```bash
pip install "hypequery[clickhouse,jwt]" fastapi uvicorn
```

```python
from fastapi import FastAPI
from hypequery.serve import HttpSecurity, create_api, jwt_strategy, to_asgi_app

api = create_api(
    auth=jwt_strategy(
        jwks_url="https://example.auth0.com/.well-known/jwks.json",
        issuer="https://example.auth0.com/",
        audience="https://api.example.com",
    ),
    client=analytics,
    datasets={"orders": orders},
    security=HttpSecurity(allowed_hosts=("api.example.com",)),
)

app = FastAPI()
app.mount("/analytics", to_asgi_app(api))
```

`POST /analytics/datasets/orders/query` now runs the same validated, tenant-scoped
query as the Python call above. The same endpoints feed generated, type-safe React
hooks (`@hypequery/react`) and a governed MCP server (`@hypequery/mcp`) that gives
agents named metrics instead of raw SQL.

## Learn more

- [Quick start](https://hypequery.com/docs/python/quick-start)
- [Python CLI](https://hypequery.com/docs/python/cli): guided setup from a live schema, with FastAPI, Django or Flask scaffolds
- [FastAPI](https://hypequery.com/docs/python/fastapi), [Django](https://hypequery.com/docs/python/django), [Flask](https://hypequery.com/docs/python/flask)
- [DataFrames](https://hypequery.com/docs/python/dataframes): pandas, polars and Arrow results
- [React and MCP clients](https://hypequery.com/docs/python/client-endpoints)
- [Changelog](https://github.com/hypequery/hypequery/blob/main/python/hypequery/CHANGELOG.md)
- [Source and issues](https://github.com/hypequery/hypequery)

hypequery is Apache 2.0 licensed. The TypeScript edition, with a type-safe query
builder, lives in the same repository and implements the same specifications.

> **Beta.** The Python SDK is tested end to end from the installed package, but
> its APIs may still change before 1.0. Pin the version you deploy and report
> problems on [GitHub](https://github.com/hypequery/hypequery/issues).

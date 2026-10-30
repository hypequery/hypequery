---
title: "Introducing hypequery for Python: A Semantic Layer for ClickHouse"
description: "Define ClickHouse measures, dimensions, and tenant rules once in Python, query them by name, serve them from FastAPI, Django, or Flask, and use them from type-safe React hooks and AI agents."
seoTitle: "Introducing hypequery for Python: A ClickHouse Semantic Layer for FastAPI, Django, and Flask"
seoDescription: "hypequery for Python brings code-first datasets to ClickHouse: typed definitions, tenant-safe queries, result caching, and authenticated endpoints you mount in FastAPI, Django, Flask, or any ASGI or WSGI app."
pubDate: 2026-10-07
heroImage: ""
slug: introducing-hypequery-python
status: draft
tags:
  - ClickHouse
  - Python
  - FastAPI
  - Django
  - Flask
  - Semantic layer
---

Today we are launching the **hypequery for Python beta**: the same code-first semantic layer for ClickHouse that TypeScript teams use, now as a Python SDK.

You define datasets in Python: the dimensions people can group by, the measures they can aggregate, the relationships between tables, and the tenant rules every query must follow. Then you query those definitions by name from jobs, notebooks, and services, serve them over HTTP from the framework you already use (FastAPI, Django, Flask, or any ASGI or WSGI app) with authentication on by default, and use the same definitions from generated, type-safe React hooks and from AI agents over MCP.

```bash
pip install "hypequery[clickhouse]==0.1.0b1"
```

This is a beta (`0.1.0b1`): the APIs may still change before 1.0, so pin the version you deploy.

## Why Python

Plenty of ClickHouse analytics lives in Python: data pipelines, scheduled reports, notebooks, and FastAPI, Django, and Flask backends. Those teams hit the same problem TypeScript teams do. The definition of revenue is copied across services, each copy drifts, and in a multi-tenant product every query depends on someone remembering the tenant filter.

A driver like clickhouse-connect gets rows out of ClickHouse. It does not know what revenue means, which fields a caller may group by, or how to keep one customer's data away from another. That is the job of a semantic layer, and we think it belongs in your codebase rather than in YAML files or a separate server.

## Define a dataset

A dataset maps a ClickHouse table to named dimensions and measures. It is plain Python, validated when you create it, and reviewed in pull requests like the rest of your application.

```python
from hypequery.datasets import Dataset, dimension, measure

orders = Dataset(
    name="orders",
    source="orders",
    tenant_key="tenant_id",
    time_key="created_at",
    dimensions={
        "country": dimension("string"),
        "status": dimension("string"),
        "created_at": dimension("timestamp"),
    },
    measures={
        "revenue": measure.sum("amount"),
        "order_count": measure.count("id"),
    },
)
```

## Query it by name

Queries select semantic names. hypequery plans parameterized ClickHouse SQL and adds the tenant predicate from a trusted execution context, never from the query itself.

```python
from hypequery.datasets import DatasetQuery, ExecutionContext, create_dataset_client, filter, tenant
from hypequery.execution import ClickHouseConnection, create_clickhouse_executor

executor = create_clickhouse_executor(
    ClickHouseConnection(host="localhost", database="analytics")
)
analytics = create_dataset_client(executor=executor)

result = analytics.execute(
    orders,
    DatasetQuery(
        dimensions=("country",),
        measures=("revenue", "order_count"),
        filters=(filter.eq("status", "completed"),),
        by="month",
    ),
    context=ExecutionContext(tenant=tenant("org_123")),
)
```

A query against a tenant-scoped dataset without tenant context is rejected, and so is a filter that tries to set the tenant itself. The client also supports sync and async execution, result caching with tenant-safe keys, validation without execution, and to-one relationships with automatic joins.

## Serve it from your app

When a dashboard, a customer, or an integration needs the same numbers over HTTP, create an API, register the dataset as an endpoint, and mount it in the app you already run:

```python
from fastapi import FastAPI
from hypequery.serve import (
    Credential,
    EndpointPolicy,
    HttpSecurity,
    Principal,
    add_dataset_endpoint,
    create_api,
    to_asgi_app,
)


async def authenticate(credential: Credential) -> Principal | None:
    claims = await verify_jwt(credential.value)  # your token verification
    if claims is None:
        return None
    return Principal(
        subject=claims["sub"],
        scopes=frozenset(claims.get("scope", "").split()),
        tenant_id=claims.get("org_id"),
    )


api = create_api(
    auth=authenticate,
    security=HttpSecurity(allowed_hosts=("analytics.example.com",)),
)
add_dataset_endpoint(
    api,
    "/datasets/orders/query",
    dataset=orders,
    client=analytics,
    policy=EndpointPolicy(required_scopes=frozenset({"analytics:read"}), tenant="required"),
)

app = FastAPI()  # your existing app and routes
app.mount("/analytics", to_asgi_app(api))
```

The API isn't tied to FastAPI. The same `api` mounts natively in Django with `path("analytics/", include(urls(api)))`, in Flask with `app.register_blueprint(blueprint(api), url_prefix="/analytics")`, under Starlette's `Mount`, or behind uvicorn or gunicorn with `to_asgi_app(api)` and `to_wsgi_app(api)`.

Every route requires authentication unless you mark it public, and authentication runs before the request body is read. Request bodies are validated strictly, so a caller cannot slip in SQL, an extra field, or a different tenant. Built in: JWT verification, roles and scopes per endpoint, rate limiting, CORS, trusted proxies, request ids, a discovery catalog, and a production profile. In Django and Flask apps, endpoints can also use your app's own login session, with a same-origin check, instead of a token.

## Django, Flask, and notebooks

You don't need HTTP to use the model. The Django and Flask integrations give every request a client already bound to the signed-in user's tenant, and results convert straight to DataFrames:

```python
# a Django view, with hypequery.contrib.django installed
def revenue_by_country(request):
    result = request.analytics.execute(
        "orders", {"dimensions": ["country"], "measures": ["revenue"]}
    )
    return JsonResponse({"data": list(result.data)})


# a notebook or a scheduled job
df = (
    analytics.for_tenant(tenant("org_123"))
    .execute("orders", {"measures": ["revenue"], "by": "month"})
    .to_pandas()
)
```

There is also an SQLAlchemy helper that reuses your engine's ClickHouse connection, and `to_polars()` and `to_arrow()` alongside `to_pandas()`.

## Type-safe React hooks and AI agents

Endpoints installed with a client profile also publish a **client contract**: the fields, operators, and limits each endpoint accepts. Export it from your definitions, and the Node CLI turns it into a typed client for the same `@hypequery/react` hooks TypeScript backends use:

```bash
python -m hypequery export client-contract --factory analytics.definitions:build --output web/client-contract.json
cd web && npx hypequery generate:client client-contract.json --output src/hypequery-client.ts
```

```tsx
const { data } = useDataset('orders', {
  dimensions: ['country'],
  measures: ['revenue'],
  filters: [{ field: 'status', operator: 'eq', value: 'completed' }],
});
// data.data rows are typed { country: string | null; revenue: string | null }
```

Misspell a field, filter a number with a string, or ask for a dimension the endpoint doesn't expose, and TypeScript stops the build. If the Python definitions change after the frontend is built, the server answers `409` instead of returning data in a shape the types don't describe.

The same endpoints serve AI agents. `hypequery mcp --client-contract-url` connects Claude, Cursor, or any MCP client to the authorized endpoints for one principal, so agents query the governed definitions, never raw SQL.

## One model, two languages

Python and TypeScript implement the same specifications and run against the same conformance fixtures. Equivalent definitions produce identical semantic and deployment artifacts, and the HTTP endpoints share one request format and response envelope, checked by shared fixtures in CI.

That means a team can define analytics in whichever language fits each service. A Python pipeline and a TypeScript API can rely on the same model without the two drifting apart.

## What's next

The Python SDK covers datasets, derived measures, relationships, execution, caching, multi-tenancy, serving from FastAPI, Django, Flask, or any ASGI or WSGI app, DataFrame output, and a CLI that scaffolds a project from your live schema today. Some newer dataset features are TypeScript-only for now, including window measures, period comparisons, segments, merge measures over `AggregatingMergeTree` state columns, and `final: true` reads. We are bringing them to Python next, and the [feature status page](/docs/python/feature-status) tracks where each one stands.

## Get started

- [Python quick start](/docs/python/quick-start): define a dataset and run your first query
- [Serve your datasets](/docs/python/serving): expose datasets as authenticated endpoints and mount them anywhere
- [Django](/docs/python/django), [Flask](/docs/python/flask), and [FastAPI](/docs/python/fastapi): framework guides
- [React and MCP clients](/docs/python/client-endpoints): typed React hooks and agent tools over the same endpoints
- [ClickHouse with Python](/clickhouse-python): how hypequery fits next to your driver

hypequery is open source under the Apache 2.0 license. If you try it, we would love to hear what you build.

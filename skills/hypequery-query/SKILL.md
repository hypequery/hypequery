---
name: hypequery-query
description: Answer analytics questions with hypequery's MCP tools or HTTP endpoints instead of writing SQL. Use when hypequery MCP tools (list_datasets, get_dataset_schema, query_dataset, query_metric) are available, or when calling a hypequery dataset or metric endpoint, to choose dimensions, measures, filters, time grains and pagination.
---

# Querying hypequery datasets

hypequery exposes a governed analytics vocabulary: datasets with named
dimensions and measures. You select from that vocabulary; the server builds and
runs the SQL, scoped to the caller's tenant. Do not write SQL and do not try to
pass a tenant — neither is accepted.

## With the MCP tools

1. `list_datasets` — the dataset groups you may use. `queryable: false` means
   metric-only: use `query_metric`, not `query_dataset`.
2. `get_dataset_schema` with `{ "dataset": "<name>" }` — each endpoint's
   dimensions (which are groupable/orderable), measures, filters with their
   operators, time grains and limits. Read descriptions before choosing fields.
3. Query:
   - `query_dataset`: `{ "dataset", "dimensions"?, "measures"?, "filters"?, "having"?, "grain"?, "timezone"?, "orderBy"?, "limit"?, "offset"?, "includeMeta"? }`
   - `query_metric`: `{ "dataset", "metric", "dimensions"?, "filters"?, "grain"?, "orderBy"?, "limit"?, "offset"? }`

```json
{
  "dataset": "orders",
  "dimensions": ["country"],
  "measures": ["revenue", "orderCount"],
  "filters": [{ "field": "status", "operator": "eq", "value": "paid" }],
  "grain": "month",
  "orderBy": [{ "field": "revenue", "direction": "desc" }],
  "limit": 20,
  "includeMeta": true
}
```

- Filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in` and `notIn`
  (a non-empty list), `between` (exactly two values), `isNull` and `isNotNull`
  (no `value`). Only the operators the schema lists for a field are accepted.
- `having` filters aggregated values: `{ "measure": "revenue", "operator": "gt", "value": 1000 }`;
  the measure must be selected.
- With a `grain`, rows carry a `period` field; order by `"period"` for a time series.
- Measure values may arrive as strings to keep decimals exact; convert before arithmetic.
- Pagination: request `includeMeta: true`; if `meta.pagination.hasMore`, repeat
  with `offset` increased by `limit`.

## Errors

Errors come back as `Error [CODE]: message` with `structuredContent.error`:

- `MCP_INVALID_ARGUMENTS` (correctable): the message names the bad path, such as
  `/dimensions/0`. Re-read the schema and fix that field; do not retry unchanged.
- `MCP_NOT_FOUND`: unknown dataset; call `list_datasets`.
- `MCP_UNAUTHORIZED`: the credential cannot use this data; tell the user.
- `MCP_STALE_CONTRACT`: definitions changed; the MCP server must be restarted.
- `MCP_QUERY_TIMEOUT` (retryable) or `MCP_RESULT_TOO_LARGE`: narrow the query —
  fewer dimensions, a coarser grain, filters or a smaller `limit`.

## Over HTTP

A served dataset endpoint takes the same body as `query_dataset` without
`dataset`, and names the grain `by` instead of `grain`:
`POST /datasets/orders/query` with `{ "measures": ["revenue"], "by": "month" }`.
The endpoint authenticates the caller and applies its tenant.

Docs: https://hypequery.com/docs/mcp/tools and https://hypequery.com/llms.txt.

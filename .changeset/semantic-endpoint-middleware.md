---
"@hypequery/serve": minor
---

Support per-endpoint middleware on metric and dataset endpoints.

Metric and dataset entries now accept a `middlewares` array, matching the
per-endpoint `auth`/`tenant`/`cache` overrides they already supported. Previously
semantic endpoints hardcoded an empty middleware list, so the only way to add
middleware was the global `use()`.

```ts
createAPI({
  datasets: {
    orders: { dataset: Orders, middlewares: [auditMiddleware] },
  },
  metrics: {
    revenue: { metric: totalRevenue, middlewares: [rateLimitMiddleware] },
  },
  queryBuilder,
});
```

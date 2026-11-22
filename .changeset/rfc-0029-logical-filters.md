---
"@hypequery/datasets": minor
"@hypequery/deployment": minor
"@hypequery/clickhouse": patch
"@hypequery/protocol-conformance": patch
---

Run `and` / `or` / `not` query filters end to end (RFC 0029). `DatasetQuery.filters` and `MetricQuery.filters` accept `{ and }`, `{ or }` and `{ not }` groups beside flat comparisons, and a flat list keeps its SQL. Each comparison is checked against the filter's allowlist with its effective operator after `not` is pushed down, and `maxFilters` counts comparisons. The portable executor runs RFC 0003 `logical` filters instead of refusing them, and the deployment data plane validates every leaf. `@hypequery/clickhouse` now renders the `notLike` operator as `NOT LIKE` instead of throwing.

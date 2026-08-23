---
"@hypequery/clickhouse": minor
---

Support `AbortSignal` on query, stream, and insert execution.

`execute()`, `stream()`, `streamForEach()`, `rawQuery()`, and `insert().execute()` now accept an `abortSignal` that is forwarded to the ClickHouse client, so callers can cancel in-flight requests (e.g. when an HTTP request is aborted or a component unmounts).

```ts
const controller = new AbortController();
const rows = await db.table('events').select(['id']).execute({ abortSignal: controller.signal });
```

Abortable executions never join another caller's deduplicated in-flight query, and background `stale-while-revalidate` refreshes keep running after the caller aborts.

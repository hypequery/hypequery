---
"@hypequery/clickhouse": minor
---

Support `AbortSignal` on query, stream, and insert execution.

`execute()`, `stream()`, `streamForEach()`, `rawQuery()`, and `insert().execute()` now accept an `abortSignal` that is forwarded to the ClickHouse client, so callers can cancel in-flight requests (e.g. when an HTTP request is aborted or a component unmounts).

```ts
const controller = new AbortController();
const rows = await db.table('events').select(['id']).execute({ abortSignal: controller.signal });
```

Deduplicated executions stay deduplicated: callers of the same cache key share one query, each caller's abort rejects only that caller, and the shared query is cancelled once no waiter is left. Background `stale-while-revalidate` refreshes keep running after the caller that triggered them aborts.

Cancellation stays active across the whole request lifecycle: an already-aborted signal rejects before any HTTP request or cache write happens, aborting while a result body is still being read rejects with the signal's reason and closes the result set, and aborting mid-stream errors the consumer stream and destroys the underlying connection stream.

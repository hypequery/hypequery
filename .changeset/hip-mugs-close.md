---
"@hypequery/clickhouse": minor
---

Add `close()` for graceful shutdown.

`createQueryBuilder(...)` now returns a `close()` method that releases the underlying ClickHouse connection pool, so processes can drain and exit without dangling keep-alive sockets. `DatabaseAdapter` gained an optional `close()` that custom adapters can implement; adapters without it resolve as a no-op.

```ts
process.on('SIGTERM', async () => {
  await server.stop();
  await db.close();
});
```

A client supplied through `createQueryBuilder({ client })` is closed as well, so only call `close()` when the builder owns the process lifetime of that client.

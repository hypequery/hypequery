---
title: "ClickHouse Connection Management in Node.js"
description: "ClickHouse uses HTTP, not TCP — so connection pooling works differently than with Postgres or MySQL. Here's the right approach for Node.js."
seoTitle: "ClickHouse Connection Pooling Node.js — Best Practices"
seoDescription: "ClickHouse uses HTTP — there is no traditional connection pool. Learn the right connection management patterns for Node.js and TypeScript with ClickHouse."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-connection-pooling-nodejs
status: published
---

Teams coming from Postgres or MySQL usually start by asking where the ClickHouse connection pool goes. That framing is slightly off. ClickHouse over HTTP has a different cost model, so the practical question is how to reuse the client instance and tune concurrency.

## ClickHouse Uses HTTP, Not TCP

Postgres and MySQL maintain persistent TCP connections. Each connection represents state on the server — an authenticated session, a transaction context. Connection pools exist to reuse those expensive persistent connections instead of establishing a new TCP handshake and auth round-trip on every query.

ClickHouse communicates over HTTP (port 8123) or HTTPS. HTTP is stateless and connectionless. There's no server-side session to maintain between requests. This means:

- **No connection pool is needed in the traditional sense.** There's no equivalent of a Postgres connection that stays open between queries.
- **What does matter:** HTTP keep-alive (reusing TCP connections for multiple HTTP requests), concurrency limits, and timeouts.

## The Singleton Pattern

The correct pattern is to create a single ClickHouse client instance at module load time and reuse it everywhere. The client manages an internal HTTP agent that handles keep-alive connections under the hood.

```typescript
// lib/clickhouse.ts
import { createClient } from '@clickhouse/client';

export const clickhouseClient = createClient({
  host: process.env.CLICKHOUSE_HOST ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DB ?? 'default',
  request_timeout: 30_000,        // 30s query timeout
  max_open_connections: 10,       // concurrent HTTP connections
  compression: {
    response: true,               // decompress responses
    request: false,               // don't compress small requests
  },
  clickhouse_settings: {
    connect_timeout: 5_000,
    receive_timeout: 30_000,
    send_timeout: 30_000,
  },
});
```

With hypequery, you wrap this once when initialising the query builder:

```typescript
// lib/db.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

export const db = createQueryBuilder<Schema>({
  host: process.env.CLICKHOUSE_HOST ?? 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
  database: process.env.CLICKHOUSE_DB ?? 'default',
});
```

Import `db` wherever you need it. The underlying HTTP agent is shared, keep-alive is handled automatically.

## What Not to Do

The naive pattern — creating a new client per request — wastes resources and adds latency:

```typescript
// BAD: Don't do this
app.get('/analytics', async (req, res) => {
  // This creates a new HTTP agent on every request
  const client = createClient({ host: '...' });
  const result = await client.query({ query: 'SELECT ...' });
  res.json(result);
});
```

Each call to `createClient()` allocates a new HTTP agent, which means no keep-alive benefit, no shared connection reuse, and unnecessary GC pressure.

## Configuring Timeouts

ClickHouse queries can range from milliseconds to minutes depending on the query. Set timeouts at two levels:

```typescript
export const db = createQueryBuilder<Schema>({
  host: process.env.CLICKHOUSE_HOST,
  request_timeout: 60_000,          // overall HTTP request timeout
  clickhouse_settings: {
    max_execution_time: 55,          // ClickHouse server-side limit (seconds)
  },
});
```

Setting `max_execution_time` on the server side is important — it prevents runaway queries from holding connections and consuming server resources even if the Node.js client disconnects.

## Handling Errors and Retries

ClickHouse is generally reliable but network blips happen. A simple retry wrapper for transient errors:

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 200
): Promise<T> {
  try {
    return await fn();
  } catch (err: unknown) {
    if (retries > 0 && isRetryableError(err)) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return withRetry(fn, retries - 1, delayMs * 2);
    }
    throw err;
  }
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    // Network errors, timeouts — not query errors
    return (
      err.message.includes('ECONNRESET') ||
      err.message.includes('ETIMEDOUT') ||
      err.message.includes('socket hang up')
    );
  }
  return false;
}

// Usage
const result = await withRetry(() =>
  db.table('events').select('count()').execute()
);
```

Only retry on network-level errors. Don't retry on ClickHouse query errors (syntax errors, missing columns) — those won't succeed on retry.

## In a Next.js / Serverless Environment

Serverless functions don't have long-running processes, so module-level singletons work differently. In Next.js App Router:

```typescript
// lib/db.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

// Module-level singleton. In Next.js, this module is cached per worker process.
// In true serverless (Lambda), each invocation may get a fresh module.
function createDb() {
  return createQueryBuilder<Schema>({
    host: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER!,
    password: process.env.CLICKHOUSE_PASSWORD!,
  });
}

let _db: ReturnType<typeof createDb> | null = null;

export function getDb() {
  if (!_db) {
    _db = createDb();
  }
  return _db;
}
```

In AWS Lambda, cold starts will create a new client. Warm invocations reuse it. This is fine — the overhead is a single object allocation, not a TCP handshake.

## Summary

- ClickHouse uses HTTP — think singleton client and keep-alive, not Postgres-style pooling
- Create one client per process, reuse it everywhere
- Configure `max_open_connections` to control concurrency
- Set both client-side and server-side timeouts
- Only retry on transient network errors, not query errors
- hypequery's `createQueryBuilder()` wraps the client — call it once at module level

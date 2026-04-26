---
title: "How to Test ClickHouse Queries in TypeScript"
description: "Three strategies for testing ClickHouse queries in TypeScript — mocking the client, using a local Docker instance, and letting the type system catch errors before tests run."
seoTitle: "Testing ClickHouse Queries in TypeScript — Unit, Integration, and Mocking"
seoDescription: "Three strategies for testing ClickHouse queries in TypeScript — mocking the client, using a local ClickHouse instance, and integration testing with hypequery."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-testing-typescript
status: published
---

Testing database query code is awkward in any stack. ClickHouse adds its own quirks — no transactions to roll back, columnar storage that behaves differently from row-based databases, and a query language with ClickHouse-specific functions. This post covers three strategies, ordered from least to most confidence.

## Strategy 1: Unit Testing with Mocks

Unit tests are fast and don't require a running database. The tradeoff: you're testing your application logic, not whether the query actually works.

With hypequery, the query builder is injectable, which makes mocking straightforward:

```typescript
// analytics.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

export function createDb() {
  return createQueryBuilder<Schema>({ host: process.env.CLICKHOUSE_HOST! });
}

type DB = ReturnType<typeof createDb>;

export async function getDailyActiveUsers(db: DB, date: string): Promise<number> {
  const rows = await db
    .table('events')
    .select('uniq(user_id) as dau')
    .where('toDate(created_at)', 'eq', date)
    .execute();

  return Number(rows[0]?.dau ?? 0);
}
```

```typescript
// analytics.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getDailyActiveUsers } from './analytics';

describe('getDailyActiveUsers', () => {
  it('returns the dau count from the query result', async () => {
    const mockDb = {
      table: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([{ dau: '4231' }]),
    } as any;

    const result = await getDailyActiveUsers(mockDb, '2026-04-25');

    expect(result).toBe(4231);
    expect(mockDb.table).toHaveBeenCalledWith('events');
    expect(mockDb.where).toHaveBeenCalledWith('toDate(created_at)', 'eq', '2026-04-25');
  });

  it('returns 0 when no rows are returned', async () => {
    const mockDb = {
      table: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
    } as any;

    const result = await getDailyActiveUsers(mockDb, '2026-04-25');
    expect(result).toBe(0);
  });
});
```

Unit tests are good for: transformation logic, error handling, default values, edge cases. They are not good for: catching wrong column names, wrong SQL, type mismatches between query and schema.

## Strategy 2: Integration Testing with a Local ClickHouse Instance

For real confidence, run queries against an actual ClickHouse instance. Docker makes this easy:

```yaml
# docker-compose.test.yml
services:
  clickhouse:
    image: clickhouse/clickhouse-server:24.3
    ports:
      - "8123:8123"
    environment:
      CLICKHOUSE_DB: test_db
      CLICKHOUSE_USER: default
      CLICKHOUSE_PASSWORD: ""
    healthcheck:
      test: ["CMD", "clickhouse-client", "--query", "SELECT 1"]
      interval: 5s
      timeout: 5s
      retries: 10
```

Set up a test helper that creates tables, seeds data, and tears down after each test:

```typescript
// test/setup.ts
import { createClient } from '@clickhouse/client';
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from '../schema';

const rawClient = createClient({
  host: 'http://localhost:8123',
  database: 'test_db',
});

export const db = createQueryBuilder<Schema>({
  host: 'http://localhost:8123',
  database: 'test_db',
});

export async function seedEvents(events: Array<{
  id: string;
  user_id: string;
  event_type: string;
  created_at: string;
}>) {
  await rawClient.command({
    query: `
      CREATE TABLE IF NOT EXISTS events (
        id String,
        user_id String,
        event_type String,
        created_at DateTime
      ) ENGINE = MergeTree()
      ORDER BY (created_at, id)
    `,
  });

  await rawClient.insert({
    table: 'events',
    values: events,
    format: 'JSONEachRow',
  });
}

export async function truncateEvents() {
  await rawClient.command({ query: 'TRUNCATE TABLE IF EXISTS events' });
}
```

```typescript
// analytics.integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, seedEvents, truncateEvents } from './test/setup';
import { getDailyActiveUsers } from './analytics';

describe('getDailyActiveUsers (integration)', () => {
  beforeEach(async () => {
    await seedEvents([
      { id: '1', user_id: 'u1', event_type: 'page_view', created_at: '2026-04-25 10:00:00' },
      { id: '2', user_id: 'u2', event_type: 'click', created_at: '2026-04-25 11:00:00' },
      { id: '3', user_id: 'u1', event_type: 'page_view', created_at: '2026-04-25 12:00:00' },
    ]);
  });

  afterEach(async () => {
    await truncateEvents();
  });

  it('counts unique users, not unique events', async () => {
    // u1 appears twice — should count as 1
    const dau = await getDailyActiveUsers(db, '2026-04-25');
    expect(dau).toBe(2);
  });
});
```

Run the test suite with `docker compose -f docker-compose.test.yml up -d` before running `vitest`. In CI, add a health check step to wait for ClickHouse to be ready before running tests.

## Strategy 3: Compile-Time Type Checking

This isn't a test strategy in the traditional sense, but it eliminates an entire class of bugs before any test runs.

hypequery's schema generation produces TypeScript types from your ClickHouse schema:

```bash
npx @hypequery/cli generate --output ./schema.ts
```

The generated schema encodes column names and types. If you reference a column that doesn't exist or pass the wrong type to `.where()`, TypeScript catches it at compile time:

```typescript
// TypeScript error: Argument of type '"user_idd"' is not assignable
// to parameter of type keyof EventsTable
db.table('events').select('user_idd', 'event_type');

// TypeScript error: type mismatch — created_at is DateTime (string), not number
db.table('events').where('created_at', 'eq', 12345);
```

This means you don't need integration tests for basic schema correctness — the type checker handles it. Your integration tests can focus on behaviour: does the query return the right aggregated results, are edge cases handled, does pagination work correctly?

## Putting It Together

A practical test strategy for a ClickHouse + hypequery TypeScript project:

1. **Type check** (`tsc --noEmit`) in CI — catches column name and type errors immediately.
2. **Unit tests** for application logic that sits around queries — transformations, defaults, error handling.
3. **Integration tests** for queries that have non-obvious behaviour — aggregations, window functions, PREWHERE logic, anything where you want to confirm the SQL does what you think.

Keep the integration test database separate from dev and production. Seed only the data each test needs, and clean up after. ClickHouse's `TRUNCATE TABLE` is fast even on large test datasets because it drops and recreates the data parts rather than deleting rows individually.

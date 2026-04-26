---
title: "How to Paginate ClickHouse Results in TypeScript"
description: "Three pagination patterns for ClickHouse in TypeScript — offset/limit, cursor-based, and keyset. Know when each applies and how to implement them."
seoTitle: "ClickHouse Pagination in TypeScript — Offset, Cursor, and Keyset"
seoDescription: "Three pagination patterns for ClickHouse in TypeScript — offset/limit, cursor-based, and keyset. Code examples with hypequery and the raw @clickhouse/client."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-pagination-typescript
status: published
---

Paginating ClickHouse results is straightforward at small scale and becomes a real problem at large scale. This post covers the three patterns you'll encounter — offset/limit, cursor-based, and keyset — and shows how to implement each with hypequery.

## Offset / Limit Pagination

The simplest approach. Ask for rows 0–49, then 50–99, and so on.

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from './schema';

const db = createQueryBuilder<Schema>({ host: 'http://localhost:8123' });

async function getPagedEvents(page: number, pageSize: number) {
  return db
    .table('events')
    .select('id', 'user_id', 'event_type', 'created_at')
    .orderBy('created_at', 'DESC')
    .limit(pageSize)
    .offset(page * pageSize)
    .execute();
}

// Page 0: rows 0–49
const firstPage = await getPagedEvents(0, 50);
// Page 3: rows 150–199
const fourthPage = await getPagedEvents(3, 50);
```

This works fine for small tables or when users only browse the first few pages. The problem surfaces at scale.

**Why OFFSET is expensive on ClickHouse:** ClickHouse is a columnar database optimised for full-scan aggregations, not point lookups. When you write `OFFSET 100000 LIMIT 50`, ClickHouse still reads and processes the first 100,000 rows — it just discards them before returning results. The deeper into the dataset you page, the more work gets thrown away. On a table with hundreds of millions of rows, page 10,000 is genuinely slow.

Use offset pagination when:
- The dataset is small (< 1M rows in the result set)
- Users won't browse past the first few pages
- You need to jump to an arbitrary page number

## Cursor-Based Pagination

Instead of tracking a page number, you track the last item you saw. Each response includes a cursor (usually the ID or timestamp of the last row), and the next request uses that cursor as a WHERE condition.

```typescript
interface EventCursor {
  lastId: string;
  lastCreatedAt: string;
}

async function getEventsAfterCursor(cursor: EventCursor | null, pageSize: number) {
  let query = db
    .table('events')
    .select('id', 'user_id', 'event_type', 'created_at')
    .orderBy('created_at', 'DESC')
    .orderBy('id', 'DESC')
    .limit(pageSize);

  if (cursor) {
    // Fetch rows that come after the cursor position
    query = query.where('created_at', '<', cursor.lastCreatedAt);
  }

  const rows = await query.execute();

  const nextCursor: EventCursor | null =
    rows.length === pageSize
      ? { lastId: rows[rows.length - 1].id, lastCreatedAt: rows[rows.length - 1].created_at }
      : null;

  return { rows, nextCursor };
}

// First page
const { rows, nextCursor } = await getEventsAfterCursor(null, 50);

// Next page
if (nextCursor) {
  const nextPage = await getEventsAfterCursor(nextCursor, 50);
}
```

This is better for infinite scroll and feed-style UIs. You can't jump to page 47, but you don't need to for most analytics use cases.

## Keyset Pagination

Keyset pagination is the most performant pattern for large datasets. It works by filtering on an indexed column — typically a timestamp or auto-incrementing ID — so ClickHouse can use the primary key or sort key to skip directly to the right place in the data.

The key difference from cursor pagination is precision: you filter on both the timestamp and the ID together to handle ties correctly.

```typescript
interface KeysetCursor {
  createdAt: string;
  id: string;
}

async function getEventsKeyset(cursor: KeysetCursor | null, pageSize: number) {
  let query = db
    .table('events')
    .select('id', 'user_id', 'event_type', 'created_at')
    .orderBy('created_at', 'DESC')
    .orderBy('id', 'DESC')
    .limit(pageSize);

  if (cursor) {
    // Fetch rows where (created_at, id) < (cursor.createdAt, cursor.id)
    // This handles ties on created_at correctly
    query = query.whereGroup((qb) => {
      qb.where('created_at', 'lt', cursor.createdAt).orWhereGroup((innerQb) => {
        innerQb.where('created_at', 'eq', cursor.createdAt).where('id', 'lt', cursor.id);
      });
    });
  }

  const rows = await query.execute();

  const lastRow = rows[rows.length - 1];
  const nextCursor: KeysetCursor | null =
    rows.length === pageSize
      ? { createdAt: lastRow.created_at, id: lastRow.id }
      : null;

  return { rows, nextCursor };
}
```

Keyset pagination is fast because ClickHouse can evaluate the WHERE condition against indexed columns without reading discarded rows. hypequery's `.where()` and `.orderBy()` make it composable — you can build the base query once and add the cursor condition conditionally.

## Choosing the Right Pattern

| Pattern | Use case | Performance at scale |
|---|---|---|
| Offset/limit | Small datasets, arbitrary page jumps | Degrades with depth |
| Cursor | Infinite scroll, chronological feeds | Good |
| Keyset | High-volume analytics, large result sets | Best |

For most analytics dashboards built on ClickHouse, keyset or cursor pagination is the right default. If you're building a simple admin table with a few thousand rows, offset/limit is fine and easier to implement.

hypequery's fluent API makes all three patterns clean to write. The `.limit()`, `.offset()`, and `.where()` methods chain naturally, and the TypeScript types ensure your cursor values match the schema columns you're filtering on.

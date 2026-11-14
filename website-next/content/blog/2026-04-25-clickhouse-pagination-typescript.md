---
title: "How to Paginate ClickHouse Results in TypeScript"
description: "Three pagination patterns for ClickHouse in TypeScript — offset/limit, cursor-based, and keyset. Know when each applies and how to implement them."
seoTitle: "ClickHouse Pagination: Cursor (Keyset) vs LIMIT OFFSET"
seoDescription: "Paginate ClickHouse with a cursor on the sort key, not a deep OFFSET: OFFSET still reads every skipped row. Offset, cursor and keyset patterns with TypeScript code."
pubDate: 2026-04-25
updatedAt: 2026-11-14
heroImage: ""
slug: clickhouse-pagination-typescript
status: published
---

Short answer: for anything past the first few pages, paginate ClickHouse with a cursor on the table's sort key (`WHERE created_at < last_created_at OR (created_at = last_created_at AND id < last_id) ORDER BY created_at DESC, id DESC LIMIT 50`) rather than `LIMIT 50 OFFSET n`. ClickHouse still reads and discards every row before the offset, so deep OFFSET pages get slower as `n` grows, while a cursor lets the primary index skip to the next page. Write the cursor condition with `OR` as shown, not as a tuple comparison: on ClickHouse 25.8, `(created_at, id) < (x, y)` read all 245 granules of a 2-million-row test table while the `OR` form read 1, and the tuple form also read all 245 on 26.10. For a copy-paste version, see the [cursor pagination recipe](/recipes/cursor-pagination).

## Quick answers

### How do you paginate results in ClickHouse?

Order by the table's sort key, return a page with `LIMIT`, and pass the last row's sort-key values back as a cursor: `WHERE created_at < last_created_at OR (created_at = last_created_at AND id < last_id) ORDER BY created_at DESC, id DESC LIMIT 50`. Avoid the tuple form `(created_at, id) < (...)`: ClickHouse doesn't use the primary index for it. Use `LIMIT n OFFSET m` only for small result sets or the first few pages.

### Is OFFSET slow in ClickHouse?

It gets slower the deeper you go. `OFFSET 100000 LIMIT 50` still reads and processes the first 100,000 rows and then throws them away, so page 10,000 costs far more than page 1.

### What is the difference between cursor and keyset pagination?

Both filter on the last row you returned instead of counting rows to skip. Keyset pagination filters on the timestamp and the ID together, so rows that share a timestamp are neither skipped nor repeated.

## Three patterns

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
    .select(['id', 'user_id', 'event_type', 'created_at'])
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
    .select(['id', 'user_id', 'event_type', 'created_at'])
    .orderBy('created_at', 'DESC')
    .orderBy('id', 'DESC')
    .limit(pageSize);

  if (cursor) {
    // Fetch rows that come after the cursor position
    query = query.where('created_at', 'lt', cursor.lastCreatedAt);
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
    .select(['id', 'user_id', 'event_type', 'created_at'])
    .orderBy('created_at', 'DESC')
    .orderBy('id', 'DESC')
    .limit(pageSize);

  if (cursor) {
    // Rows before the cursor: created_at < c.createdAt OR (created_at = c.createdAt AND id < c.id)
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

---
title: "Why ClickHouse Types Break in TypeScript (and How to Fix Them)"
description: "What ClickHouse actually returns to JavaScript for DateTime, UInt64, Decimal, Nullable and more, why hand-written interfaces hide it, and how generated types, one shared query definition and an incremental migration from raw SQL fix it."
seoTitle: "ClickHouse TypeScript Types: Why They Break, How to Fix"
seoDescription: "What ClickHouse returns to JavaScript for DateTime, UInt64, Decimal and Nullable, why hand-written types hide it, and how generated types fix it."
pubDate: 2026-04-14
updated: 2026-11-08
heroImage: ""
slug: clickhouse-typescript-type-problem
status: published
---

ClickHouse types break in TypeScript because the JSON that ClickHouse sends over HTTP doesn't match what the SQL column types suggest, and a hand-written row interface is an assertion that nothing checks. `DateTime` arrives as a string, not a `Date`. `UInt64` arrives as a string or as a number that silently loses precision, depending on a server setting. `Decimal` arrives as a JSON number. `Nullable(T)` gives `null`, not `undefined`. The fix is to generate types from the live schema, query through a builder that knows those mappings, and define each query once so every consumer shares the same types.

Every value below was checked with `FORMAT JSONEachRow` on ClickHouse 26.6. For the wider TypeScript workflow, see the [ClickHouse TypeScript guide](/clickhouse-typescript).

## Quick answers

### Why does my ClickHouse UInt64 come back as a string?

`UInt64` values can exceed `Number.MAX_SAFE_INTEGER`, so clients ask ClickHouse to quote them with `output_format_json_quote_64bit_integers = 1`. hypequery sends that setting on every query. Since ClickHouse 25.8 the server default is `0`, so a raw client that doesn't set it receives plain JSON numbers, and `18446744073709551615` parses as `18446744073709552000`.

### Why is ClickHouse DateTime a string, not a Date?

JSON has no date type. ClickHouse sends `DateTime` as `"2026-11-08 10:00:00"`, in the column's or server's time zone, with no offset. Type it as `string` and parse it deliberately.

### Is ClickHouse Decimal a string in JavaScript?

Not by default. On 26.6 `Decimal` is sent as a JSON number, so values with more than about 15 significant digits lose precision when parsed. Set `output_format_json_quote_decimals = 1` if you need exact strings.

### How do I generate TypeScript types from a ClickHouse schema?

Run `npx hypequery generate`. It introspects your tables and writes a schema file the query builder uses to type every query's columns, filters and results. See [the fix](#the-fix-generate-types-from-the-live-schema).

---

## What ClickHouse actually returns

| ClickHouse type | JSON on 26.6 (server defaults) | With hypequery | TypeScript type |
|---|---|---|---|
| `String`, `FixedString(n)`, `UUID`, `IPv4`, `IPv6` | string | string | `string` |
| `Enum8`, `Enum16` | string | string | `string` |
| `Int8` to `Int32`, `UInt8` to `UInt32` | number | number | `number` |
| `Int64`, `UInt64`, 128- and 256-bit ints | number (precision loss above 2^53) | string | `string` |
| `Float32`, `Float64` | number, `NaN` becomes `null` | same | `number` |
| `Decimal(p, s)` | number (precision loss past ~15 digits) | same | `number` |
| `Date`, `Date32`, `DateTime`, `DateTime64` | string | string | `string` |
| `Bool` | boolean | boolean | `boolean` |
| `Nullable(T)` | `null` when empty | same | `T \| null` |
| `LowCardinality(T)` | as `T` | same | as `T` |
| `Array(T)` | array | array | `T[]` |
| `Tuple(a T1, b T2)` (named) | object | object | `{ a: T1; b: T2 }` |
| `Tuple(T1, T2)` (unnamed) | array | array | `[T1, T2]` |
| `Map(K, V)` | object | object | `Record<string, V>` |
| `JSON` | object | object | `unknown` |

The rows that cause most production bugs are the first string rows: 64-bit integers, dates, and anything you assumed was a `Date` or a safe `number`.

### DateTime and DateTime64

`DateTime64(3)` arrives as `"2026-01-01 00:00:00.123"`. The string has no offset, and JavaScript parses that format as local time: in a Paris process, `new Date("2026-01-01 00:00:00")` is `2025-12-31T23:00:00.000Z`. If the column is UTC, parse it as UTC on purpose:

```ts
const parsed = new Date(row.created_at.replace(' ', 'T') + 'Z');
```

Or have ClickHouse render the time zone you want, for example `toString(created_at, 'UTC')`.

### 64-bit integers, and every count()

`count()`, `uniq()` and `sum()` over integer columns return `UInt64`, so these are strings through hypequery. Adding two of them with `+` concatenates. `sum()` over a `Float64` column and `avg()` return `Float64` and arrive as numbers.

The query builder types every aggregate result as `string`, which is exact for counts and conservative for float sums. `Number(row.total)` is correct for both, so convert at the display layer. For counts that can exceed 2^53, use `BigInt(row.total)`.

### Decimal

`toDecimal128('12345678901234567.89', 2)` arrives as the JSON number `12345678901234567.89`, which `JSON.parse` turns into `12345678901234568`. For money with many digits, set `output_format_json_quote_decimals = 1` per query with `.settings(...)` and treat the value as a string. Note that hypequery's generated types say `number` for `Decimal`, matching the server default.

### Nullable

Empty values are `null`. A check for `=== undefined` never fires. `Nullable` columns are `T | null` in generated types.

## Why hand-written types hide all of this

Most ClickHouse TypeScript code starts like this:

```ts
import { createClient } from '@clickhouse/client';

const client = createClient({ url: process.env.CLICKHOUSE_URL });

// Hand-written. Nothing checks this against the table.
interface OrderRow {
  id: string;
  tenant_id: number;
  total: number;
  status: string;
  created_at: string;
}

export async function recentOrders(tenantId: number) {
  const result = await client.query({
    query: `
      SELECT * FROM orders
      WHERE tenant_id = {tenantId:UInt32}
      ORDER BY created_at DESC
      LIMIT 50
    `,
    query_params: { tenantId },
    format: 'JSONEachRow',
  });
  return result.json<OrderRow>();
}
```

`result.json<OrderRow>()` is a type assertion, not validation. Now someone renames a column:

```sql
ALTER TABLE orders RENAME COLUMN total TO total_amount;
```

Queries that name `total` fail loudly with an unknown identifier error. This one uses `SELECT *`, so it keeps succeeding; the rows just come back with `total_amount` instead. The interface still says `total: number`, so this compiles:

```ts
const orders = await recentOrders(42);
const gross = orders.reduce((sum, o) => sum + o.total, 0);
// o.total is undefined at runtime, so gross is NaN
```

The dashboard renders `NaN`. No exception, no failed request, no alert. And the interface was already wrong in quieter ways: had it included a `UInt64` column typed as `number`, it would have been a string through any client that quotes 64-bit integers.

## The fix: generate types from the live schema

Make the schema the source of truth:

```bash
npm install @hypequery/clickhouse
npm install -D @hypequery/cli
npx hypequery generate
```

`hypequery generate` reads your connection from `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME` and `CLICKHOUSE_PASSWORD` and writes `analytics/schema.ts`. For each table it writes the ClickHouse type strings, which the builder maps to TypeScript, plus a record type with the TypeScript types:

```ts
export interface IntrospectedSchema {
  orders: {
    'id': "String";
    'tenant_id': "UInt32";
    'total_amount': "Float64";
    'status': "LowCardinality(String)";
    'created_at': "DateTime";
  };
}

export interface OrdersRecord {
  'id': string;
  'tenant_id': number;
  'total_amount': number;
  'status': string;
  'created_at': string;
}
```

Query through the builder and the result type comes from the schema:

```ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './schema';

export const db = createQueryBuilder<IntrospectedSchema>({
  url: process.env.CLICKHOUSE_URL!,
  username: process.env.CLICKHOUSE_USERNAME,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

export function recentOrders(tenantId: number) {
  return db
    .table('orders')
    .select(['id', 'total_amount', 'status', 'created_at'])
    .where('tenant_id', 'eq', tenantId)
    .orderBy('created_at', 'DESC')
    .limit(50)
    .execute();
}
// Promise<{ id: string; total_amount: number; status: string; created_at: string }[]>
```

Replay the rename: run `npx hypequery generate`, `total` disappears from the schema, and every `.select(['total'])`, `.sum('total', ...)` and `o.total` becomes a compile error. `tsc` hands you the list of call sites. Wrong tables and columns, `'in'` with a single value instead of an array, and unknown operators such as `'='` (the builder uses `'eq'`) are compile errors too.

## Define each query once

Generated types fix one query. The other source of drift is the same query rewritten for a script, an HTTP endpoint and a React component, each with its own idea of the row shape. Define it once with `@hypequery/serve`:

```ts
// analytics/api.ts
import { initServe } from '@hypequery/serve';
import { z } from 'zod';
import { db } from './client';

const { query, serve } = initServe({
  basePath: '/api/analytics',
  context: () => ({ db }),
});

export const revenueByStatus = query({
  description: 'Revenue by order status since a date',
  input: z.object({ since: z.string() }),
  query: ({ ctx, input }) =>
    ctx.db
      .table('orders')
      .select(['status'])
      .sum('total_amount', 'revenue')
      .where('created_at', 'gte', input.since)
      .groupBy(['status'])
      .execute(),
});

export const api = serve({ queries: { revenueByStatus } });
```

The same definition now serves three consumers with one inferred type:

- **In-process**, for jobs and server components: `await api.run('revenueByStatus', { input: { since: '2026-10-01' } })`.
- **Over HTTP**, at `GET /api/analytics/queries/revenueByStatus?since=2026-10-01`, with zod validation and an OpenAPI entry. `npx hypequery dev analytics/api.ts` serves it locally with interactive docs.
- **In React**, through hooks typed with `InferApiType<typeof api>`, so `data` in a component has the row shape the builder returns. The [React and Next.js dashboard guide](/blog/building-dashboards-clickhouse-hypequery-nextjs) sets this up.

Rename a column and the compiler follows it from the schema through the query and the API into the component.

## Migrating from raw SQL strings, one query at a time

Don't rewrite everything. hypequery is built on `@clickhouse/client`, so both run in the same process against the same server.

### 1. Install alongside

Point `createQueryBuilder` at the same URL and database, commit the generated schema, and ship with no queries migrated. You now have schema types in the repo even for code that still uses strings.

### 2. Migrate the queries that change most

Rank queries by how often they are edited, not how often they run. Product-facing dashboard queries, anything filtered by tenant, and anything the next engineer will extend come first. They are usually filter-aggregate-group-order queries, which the builder covers completely.

### 3. Keep hand-tuned SQL, inside typed queries

A long, tuned funnel query is a liability to rewrite. Three escape hatches keep raw SQL inside otherwise typed queries:

```ts
import { rawAs } from '@hypequery/clickhouse';
import { db } from './client';

// A raw expression with a declared result type
export const withTaxedTotal = await db
  .table('orders')
  .select(['id', rawAs<number, 'taxed'>('round(total_amount * 1.2, 2)', 'taxed')])
  .where('status', 'eq', 'completed')
  .execute();

// A raw CTE with declared column types, joined into a typed query
export const withFirstOrder = await db
  .table('orders')
  .withCTE(
    'first_orders',
    'SELECT tenant_id, min(created_at) AS first_order_at FROM orders GROUP BY tenant_id',
    { tenant_id: 'UInt32', first_order_at: 'DateTime' },
  )
  .innerJoin('first_orders', 'tenant_id', 'first_orders.tenant_id')
  .select(['id', 'created_at', 'first_orders.first_order_at'])
  .execute();

// The whole statement as SQL, with bound parameters
export const funnel = await db.rawQuery<{ step: string; users: string }>(
  'SELECT step, uniq(user_id) AS users FROM funnel_events WHERE tenant_id = ? GROUP BY step',
  [42],
);
```

The columns and filters around a raw fragment stay checked; only the fragment is on you. For `rawQuery`, you write the row type, so remember the table above. Partial migration is a stable end state.

### 4. Catch schema drift in CI

Regenerate the schema in CI and fail if it changed:

```bash
npx hypequery generate
git diff --exit-code analytics/schema.ts
npx tsc --noEmit
```

A ClickHouse rename now fails the build in one of two ways: the generated file differs from the committed one, or `tsc` finds call sites that weren't updated. Run it against staging on a schedule too, so schema changes surface before a deploy depends on them.

### What you're trading

A dependency, a generated file to keep current, and a builder API to learn on top of SQL. If your analytics is five stable queries, raw SQL with careful review is fine; [hypequery vs raw SQL](/compare/hypequery-vs-raw-sql) works through the break-even point. The migration pays off when queries are numerous, often edited, or maintained by more people than wrote them.

## Getting started

```bash
npx @hypequery/cli init
```

`init` connects to ClickHouse, generates the schema and scaffolds a client and an example query. The [quick start](/docs/quick-start) walks through it, and the [schemas guide](/docs/schemas) covers how generated types flow through queries. For the wider picture, see [ClickHouse TypeScript](/clickhouse-typescript) and [type-safe SQL in TypeScript](/type-safe-sql-typescript).

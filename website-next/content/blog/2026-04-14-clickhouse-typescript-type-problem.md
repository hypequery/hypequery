---
title: "The ClickHouse TypeScript Type Problem (And How to Actually Fix It)"
description: "ClickHouse and TypeScript often disagree about what types come back at runtime. Learn the real mappings for DateTime, UInt64, Nullable, Decimal, and more."
seoTitle: "ClickHouse TypeScript Types: The Runtime Mapping Problem and How to Fix It"
seoDescription: "Using ClickHouse with TypeScript? Learn the real runtime mappings for DateTime, UInt64, Nullable, Decimal, and other types, and how to avoid silent bugs."
pubDate: 2026-04-14
heroImage: ""
slug: clickhouse-typescript-type-problem
status: published
---

There's a class of bug in TypeScript ClickHouse applications that doesn't show up until production. You've written your query, you've typed the response, everything compiles cleanly, and then a value that should be a number turns out to be a string, a date comparison silently fails, or a `null` check that should have fired doesn't.

If you want the broader framework around this problem, start with the [ClickHouse TypeScript](/clickhouse-typescript) pillar page. This article is the deep dive into the runtime mapping failure mode.

The types were wrong. TypeScript didn't tell you, because you wrote the types yourself and got them subtly incorrect. This is the ClickHouse TypeScript type problem.

This post maps every common ClickHouse type to what it actually returns over the wire in JavaScript, not what you might assume, and shows how to make TypeScript enforce the correct mapping at compile time.

## Why ClickHouse types don't map the way you'd expect

ClickHouse is a columnar analytics database with its own type system, designed for performance above all else. When data comes back over the HTTP interface, which both `@clickhouse/client` and hypequery use, it's serialized as JSON. That serialization doesn't always preserve the types you'd expect from the SQL column definition.

Some of this is inherent to JSON. Some of it is specific to how ClickHouse handles edge cases. All of it is silent: the query returns data, TypeScript trusts your annotations, and incorrect assumptions don't surface as errors.

Let's go through the types that bite most developers.

## DateTime and DateTime64

**What you might assume:** `Date`

**What you actually get:** `string`

```typescript
const result = await client.query({
  query: 'SELECT created_at FROM events LIMIT 1',
  format: 'JSONEachRow',
});

const rows = await result.json<{ created_at: Date }>();

console.log(typeof rows[0].created_at); // "string"
console.log(rows[0].created_at); // "2026-04-14 09:23:11"
```

ClickHouse returns `DateTime` as a formatted string over the HTTP interface, not a Unix timestamp, not an ISO 8601 string with a `Z`, and not a JavaScript `Date` object. The format is `YYYY-MM-DD HH:MM:SS`.

If you've typed it as `Date` and try to call `.toISOString()` on it, you'll get a runtime error. If you're doing date arithmetic, you'll silently get `NaN`. TypeScript won't warn you at compile time because you told it the type was `Date`.

`DateTime64` behaves the same way, with more decimal precision in the seconds.

**Correct TypeScript type:** `string`

## UInt8, UInt16, UInt32, Int8, Int16, Int32, Float32, Float64

**What you might assume:** `number`

**What you actually get:** `number`

These map as expected. Integer and float types within JavaScript's safe integer range come back as numbers.

```typescript
const result = await client.query({
  query: 'SELECT page_views FROM stats LIMIT 1',
  format: 'JSONEachRow',
});

const rows = await result.json<{ page_views: number }>();
console.log(typeof rows[0].page_views); // "number"
```

## UInt64, Int64, UInt128, Int128, UInt256, Int256

**What you might assume:** `number`

**What you actually get:** `string`

```typescript
const result = await client.query({
  query: 'SELECT id FROM large_table LIMIT 1',
  format: 'JSONEachRow',
});

const rows = await result.json<{ id: number }>();

console.log(typeof rows[0].id); // "string"
console.log(rows[0].id); // "9223372036854775807"
```

`UInt64` can hold values far above JavaScript's `Number.MAX_SAFE_INTEGER`. Any `UInt64` value above that threshold cannot be safely represented as a JavaScript number, so ClickHouse serializes these as strings to preserve precision.

If you type them as `number`, your type is wrong, and any arithmetic or comparison you do on them can produce incorrect results without a compile-time warning.

**Correct TypeScript type:** `string`

## Nullable(T)

**What you might assume:** `T | undefined`

**What you actually get:** `T | null`

```typescript
const result = await client.query({
  query: 'SELECT email FROM users LIMIT 1',
  format: 'JSONEachRow',
});

const rows = await result.json<{ email: string | undefined }>();

console.log(rows[0].email); // null, not undefined
```

ClickHouse serializes absent `Nullable` values as JSON `null`, not as a missing key. If you've typed the field as `T | undefined` and check `if (value === undefined)`, the check will never fire.

**Correct TypeScript type:** `T | null`

## LowCardinality(T)

**What you might assume:** some special type

**What you actually get:** the inner type `T`

`LowCardinality` is a storage optimization in ClickHouse. It doesn't change the logical type of the column or how values are returned.

**Correct TypeScript type:** whatever `T` maps to

## Array(T)

**What you might assume:** `T[]`

**What you actually get:** `T[]`

Arrays come back as JavaScript arrays. The inner type follows the same rules as above, so `Array(DateTime)` gives you `string[]`, not `Date[]`.

```typescript
const rows = await result.json<{ tags: string[] }>();
console.log(Array.isArray(rows[0].tags)); // true
```

**Correct TypeScript type:** `T[]`

## Tuple(T1, T2, ...)

**What you might assume:** `[T1, T2, ...]`

**What you actually get:** `[T1, T2, ...]`

Tuples come back as JavaScript arrays with fixed length. Types the same way, just apply the correct mapping to each element type.

## JSON / Object('json')

**What you might assume:** a specific interface

**What you actually get:** `unknown`, effectively

```typescript
const rows = await result.json<{ properties: Record<string, unknown> }>();
```

ClickHouse doesn't enforce schema within JSON columns. If you're storing JSON as a `String`, you get a string back and have to parse it yourself. If you're using `Object('json')`, you get back a nested object, but the shape isn't statically known without schema inspection.

**Correct TypeScript type:** `string` for JSON-as-string columns, or a specific interface if you control the shape

## The full mapping at a glance

| ClickHouse type | Correct TypeScript type |
|----------------|------------------------|
| `String` | `string` |
| `FixedString(n)` | `string` |
| `UInt8`, `UInt16`, `UInt32` | `number` |
| `Int8`, `Int16`, `Int32` | `number` |
| `Float32`, `Float64` | `number` |
| `UInt64`, `Int64` | `string` |
| `UInt128`, `Int128`, `UInt256`, `Int256` | `string` |
| `DateTime` | `string` |
| `DateTime64(n)` | `string` |
| `Date` | `string` |
| `Date32` | `string` |
| `Boolean` | `boolean` |
| `UUID` | `string` |
| `Nullable(T)` | `T \| null` |
| `LowCardinality(T)` | same as `T` |
| `Array(T)` | `T[]` |
| `Tuple(T1, T2)` | `[T1, T2]` |
| `Enum8`, `Enum16` | `string` |
| `IPv4`, `IPv6` | `string` |
| `Decimal(p, s)` | `string` |

Notice how many types map to `string` that developers commonly annotate as something else. `DateTime` as `Date`, `UInt64` as `number`, and `Decimal` as `number` are the three most common silent bugs.

## The root problem: you're writing these types by hand

Every example above assumes you're writing the TypeScript interface yourself. That's the core of the problem.

```typescript
interface EventRow {
  event_name: string;
  created_at: Date; // wrong
  user_id: number; // wrong if UInt64
  session_id: string;
}
```

TypeScript trusts you completely. There's no verification against the actual ClickHouse schema. The types compile cleanly. The bugs hide until runtime.

The only reliable fix is to generate the types from the live schema, not write them by hand.

That is the core workflow behind the [ClickHouse TypeScript](/clickhouse-typescript) pillar page: generated schema types first, reusable query definitions second.

## How hypequery solves this

hypequery's CLI connects to your ClickHouse instance and generates a TypeScript schema file that applies the correct mappings automatically:

```bash
npx hypequery generate --output analytics/schema.ts
```

The generated output for the `events` table above would look like this:

```typescript
export interface Schema {
  events: {
    event_name: string;
    created_at: string; // DateTime -> string
    user_id: string; // UInt64 -> string
    session_id: string;
  };
}
```

Every ClickHouse type is mapped to its correct JavaScript runtime equivalent. When you build queries with the generated schema, the type checker enforces these mappings throughout your application.

```typescript
const result = await db
  .table('events')
  .select(['event_name', 'created_at', 'user_id'])
  .where('event_name', 'eq', 'page_view')
  .execute();

// result: Array<{ event_name: string; created_at: string; user_id: string }>
```

When your schema changes, rerun the generator. The types update. TypeScript tells you everywhere the change has an impact.

## Getting started

```bash
npm install @hypequery/clickhouse @clickhouse/client
npx hypequery generate --output analytics/schema.ts
```

If you want the quickest path from schema to type-safe queries, start with the [Quick Start](https://hypequery.com/docs/quick-start) and then use the [Schemas](https://hypequery.com/docs/schemas) guide to understand how the generated types flow through your app.

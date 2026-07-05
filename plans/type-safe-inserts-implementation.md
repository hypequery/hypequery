# Type-Safe Inserts — Implementation Guide

**Package:** `@hypequery/clickhouse` (packages/clickhouse)
**Status:** Ready to implement
**Ship as:** minor version bump (new feature, no breaking changes) — add a changeset.

---

## 1. Goal & API surface

Add a type-safe insert API to the query builder returned by `createQueryBuilder<Schema>()`:

```ts
const db = createQueryBuilder<IntrospectedSchema>({ url: '...' });

// Single row or array of rows — fully typed from the schema
await db.insertInto('events').values({
  id: 1,
  name: 'signup',
  created_at: new Date(),        // DateTime columns accept string | Date
  optional_note: null,           // Nullable(...) columns are optional
}).execute();

// Column subset (lets ClickHouse fill DEFAULTs for omitted columns)
await db.insertInto('events')
  .columns(['id', 'name'])
  .values([{ id: 1, name: 'a' }, { id: 2, name: 'b' }])
  .execute();

// Per-insert ClickHouse settings
await db.insertInto('events')
  .values(rows)
  .settings({ async_insert: 1, wait_for_async_insert: 1 })
  .execute();
```

`execute()` resolves to `{ queryId: string; executed: boolean; summary?: unknown }` (mapped from the ClickHouse client's `InsertResult`).

Naming: use **`insertInto`** (Kysely-style). It sits beside the existing `table()` method on the object returned by `createQueryBuilder` and avoids overloading `table()`.

### Compile-time errors we must produce (the actual feature)

```ts
db.insertInto('bad_table')                          // ✗ unknown table
db.insertInto('events').values({ id: 'x', ... })    // ✗ wrong value type
db.insertInto('events').values({ id: 1 })           // ✗ missing required (non-Nullable) column
db.insertInto('events').values({ ..., nope: 1 })    // ✗ unknown column (excess property check)
db.insertInto('events').columns(['nope'])           // ✗ unknown column
db.insertInto('events').columns(['id']).values({ id: 1, name: 'x' }) // ✗ column not in subset
```

### Explicitly out of scope for v1

- Streaming inserts (`.stream(readable)`) — note as phase 2; the node client supports it, web client doesn't.
- `INSERT INTO ... SELECT` from a `QueryBuilder` — phase 2 (see §9).
- Inserts through `@hypequery/datasets` / serve — datasets are read-only semantic layer; do not touch those packages.
- SQL-text `INSERT ... VALUES` compilation via the dialect — see §5 for why.

---

## 2. Architecture context (read these files first)

| File | Why it matters |
|---|---|
| `packages/clickhouse/src/core/query-builder.ts` | `createQueryBuilder` factory (line ~1117) — where `insertInto` gets added. Also `ClickHouseConfig` types. |
| `packages/clickhouse/src/core/adapters/database-adapter.ts` | `DatabaseAdapter` interface (query/stream/render). Insert needs a new optional method here. |
| `packages/clickhouse/src/core/adapters/clickhouse-adapter.ts` | The built-in adapter wrapping `@clickhouse/client` / `client-web`. Holds the `client` privately. |
| `packages/clickhouse/src/types/clickhouse-types.ts` | `ClickHouseType` string-literal union and `InferClickHouseType<T>` (read-side inference). Insert types mirror this. |
| `packages/clickhouse/src/types/schema.ts` | `ColumnType`, `TableRecord`, `DatabaseSchema`. |
| `packages/clickhouse/src/core/types/builder-state.ts` | `SchemaDefinition` constraint used by `createQueryBuilder`. |
| `packages/clickhouse/src/core/features/executor.ts` | Logging pattern (`logger.logQuery` start/complete/error) to replicate for inserts. |
| `packages/clickhouse/src/core/utils/logger.ts` | `QueryLog` shape. |
| `packages/clickhouse/src/core/tests/test-utils.ts` | `TEST_SCHEMAS`, mock-adapter pattern for unit tests. |
| `packages/clickhouse/type-tests/query-builder-types.test.ts` | Type-test conventions (`Expect<Equal<...>>`, `@ts-expect-error`). |
| `packages/clickhouse/src/index.ts` | Public export list. There's a public-exports test at `src/core/tests/public-exports.test.ts` — update it. |

Key facts discovered during analysis — the implementer should not re-derive these:

1. **The schema is phantom at runtime.** `createQueryBuilder` builds state with `base: {} as Schema[Table]`. There is no runtime column/type map, so insert correctness is enforced by TypeScript only. Do not attempt runtime schema validation.
2. **The generated schema carries no DEFAULT info.** `cli/generate-types.js` emits only `{ column: 'TypeString' }` from `DESCRIBE TABLE`. So we cannot make defaulted columns optional at the type level — only `Nullable(...)` columns. The `.columns([...])` subset is the escape hatch for tables with defaults. (Future improvement, out of scope: have the CLI emit default-awareness; it already queries `DESCRIBE TABLE`, which returns `default_type`/`default_expression`.)
3. **`escapeValue` in `core/utils.ts` is not safe for insert literals.** Arrays/maps fall through to `'${JSON.stringify(value)}'`, which produces a quoted JSON *string*, not a ClickHouse array/map literal. This is fine for the WHERE-clause values it currently serves, but it means we must NOT build inserts by rendering `INSERT ... VALUES` SQL through the existing param substitution. Use the native client insert with `JSONEachRow` instead.
4. **Both `@clickhouse/client` (node) and `@clickhouse/client-web` expose `insert({ table, values, format, columns, clickhouse_settings, query_id })`** with a compatible `InsertResult` (`query_id`, `executed`, node adds `summary`). The union type alias `ClickHouseClient = NodeClickHouseClient | WebClickHouseClient` already exists in `clickhouse-adapter.ts`.
5. **`JSON.stringify` throws on `bigint` and serializes `Date` to ISO-8601 with `Z`.** The client serializes JSONEachRow rows with JSON.stringify, so we need a normalization pass (§5) and `date_time_input_format: 'best_effort'` by default.
6. `DatabaseAdapter` is a public seam for third-party/embedded engines (see comment in `src/index.ts` around `substituteParameters`). The new `insert` method must be **optional** on the interface; the builder throws a clear error if the adapter doesn't implement it.

---

## 3. New files

```
packages/clickhouse/src/types/insert.ts            # InsertRow / InsertValue type machinery
packages/clickhouse/src/core/insert-builder.ts     # InsertBuilder class + factory wiring types
packages/clickhouse/src/core/tests/insert-builder.test.ts
packages/clickhouse/type-tests/insert-types.test.ts
```

Modified files:

```
packages/clickhouse/src/core/adapters/database-adapter.ts   # + optional insert() and InsertExecutionOptions
packages/clickhouse/src/core/adapters/clickhouse-adapter.ts # + insert() implementation
packages/clickhouse/src/core/query-builder.ts               # + insertInto() on createQueryBuilder return
packages/clickhouse/src/index.ts                            # + exports
packages/clickhouse/src/core/tests/public-exports.test.ts   # + new export names
website-next/docs/  (see §8)
.changeset/  (minor bump for @hypequery/clickhouse)
```

---

## 4. Type design (`src/types/insert.ts`)

Mirror `InferClickHouseType` but for the *input* side: same structure, wider leaves. Import the leaf unions from `./clickhouse-types.js` (`ClickHouseJsSafeInteger`, `ClickHouseJsUnsafeInteger`, `ClickHouseFloat`, `ClickHouseDecimal`, `ClickHouseDateTime`, `ClickHouseString`, `ClickHouseEnum`, `ClickHouseBoolean`, `ClickHouseType`) and reuse the same bounded-depth pattern (`Add1`, cap at 5) — copy the `Add1` helper or export it from `clickhouse-types.ts`.

```ts
import type { ColumnType } from './schema.js';

/** Widened value type accepted when INSERTing into a column of ClickHouse type T. */
export type InsertValue<T extends string, Depth extends number = 0> =
  Depth extends 5 ? unknown
  : T extends ClickHouseJsSafeInteger ? number
  : T extends ClickHouseJsUnsafeInteger ? string | number | bigint   // wider than read side (string)
  : T extends ClickHouseFloat ? number
  : T extends ClickHouseDecimal ? number | string
  : T extends ClickHouseDateTime ? string | Date | number            // wider than read side (string)
  : T extends ClickHouseString ? string
  : T extends ClickHouseEnum ? string | number                       // enums accept name or value
  : T extends ClickHouseBoolean ? boolean
  : T extends `Array(${infer U})` ? /* recurse as InferClickHouseType does */ 
  : T extends `Tuple(${infer U})` ? /* reuse ParseTopLevelArgs pattern */ 
  : T extends `Nullable(${infer U})` ? InsertValue<U, Add1<Depth>> | null
  : T extends `LowCardinality(${infer U})` ? /* same unwrap logic as read side */ 
  : T extends `Map(${string}, ${infer V})` ? Record<string, InsertValue<V, Add1<Depth>>>
  : unknown;
```

Follow the exact recursion structure of `InferClickHouseType` (including the `U extends ClickHouseType` guards) so the two stay reviewably parallel. Rationale for widenings:

- **DateTime/Date:** users will pass `new Date()`; runtime normalizes (§5). `number` = epoch seconds/millis is intentionally allowed with best-effort parsing — if you find this too loose, drop `number`; keep `string | Date` minimum.
- **Int64/UInt64/Int128/...:** read side returns `string`, but requiring users to stringify small numbers is hostile. Accept `string | number | bigint`; runtime converts `bigint → String(v)` because JSON.stringify throws on bigint.
- **Decimal:** ClickHouse accepts numbers or strings in JSONEachRow.

Nullability partition:

```ts
type IsNullableColumn<T extends string> =
  T extends `Nullable(${string})` ? true
  : T extends `LowCardinality(Nullable(${string}))` ? true
  : false;

/** The row shape required by .values() for a full-width insert. */
export type InsertRow<Columns extends Record<string, ColumnType>> = Simplify<
  { [K in keyof Columns as IsNullableColumn<Columns[K]> extends true ? never : K]: InsertValue<Columns[K]> } &
  { [K in keyof Columns as IsNullableColumn<Columns[K]> extends true ? K : never]?: InsertValue<Columns[K]> | null }
>;

/** Row shape when a column subset was chosen via .columns([...]). */
export type InsertRowForColumns<
  Columns extends Record<string, ColumnType>,
  Keys extends keyof Columns
> = Simplify<
  { [K in Keys as IsNullableColumn<Columns[K]> extends true ? never : K]: InsertValue<Columns[K]> } &
  { [K in Keys as IsNullableColumn<Columns[K]> extends true ? K : never]?: InsertValue<Columns[K]> | null }
>;
```

(`InsertRow<C>` ≡ `InsertRowForColumns<C, keyof C>`; implement one in terms of the other. `Simplify` lives in `src/core/types/type-helpers.ts`.)

Note on excess-property checking: `.values()` takes `InsertRow<...>` directly (object literal or array of literals), so TS's excess property check catches unknown columns in the common literal case. Don't add an `Exact<>` gymnastics layer — matching the codebase's existing level of strictness is enough.

---

## 5. Runtime design

### 5.1 Adapter seam (`database-adapter.ts`)

```ts
export interface InsertExecutionOptions {
  clickhouseSettings?: ClickHouseSettings;
  queryId?: string;
  /** Explicit column subset; omitted columns take table DEFAULTs. */
  columns?: string[];
}

export interface InsertResultSummary {
  queryId: string;
  executed: boolean;
  summary?: unknown;   // node client's ClickHouseSummary when available
}

export interface DatabaseAdapter {
  // ...existing members...
  insert?<T extends Record<string, unknown>>(
    table: string,
    rows: T[],
    options?: InsertExecutionOptions
  ): Promise<InsertResultSummary>;
}
```

Optional, like `stream`. `InsertBuilder.execute()` throws `Error('Inserts are not supported by adapter "<name>". Implement DatabaseAdapter.insert to enable them.')` when absent — same pattern as the streaming check in `executor.ts:97`.

### 5.2 `ClickHouseAdapter.insert`

```ts
async insert<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  options?: InsertExecutionOptions
): Promise<InsertResultSummary> {
  const result = await this.client.insert({
    table,
    values: rows,
    format: 'JSONEachRow',
    ...(options?.columns ? { columns: options.columns } : {}),
    clickhouse_settings: {
      date_time_input_format: 'best_effort',   // lets ISO 'Z' timestamps parse into DateTime
      ...options?.clickhouseSettings,           // user settings win
    },
    query_id: options?.queryId,
  });
  return {
    queryId: result.query_id,
    executed: result.executed,
    summary: (result as { summary?: unknown }).summary,
  };
}
```

Typing note: `this.client` is the node/web union; the `insert` signatures differ slightly between the two (node accepts streams for `values`). Since we only pass arrays, call through a narrowed local: `const client = this.client as NodeClickHouseClient;` with a comment, or build the params object typed as the node client's `InsertParams`. Either is fine — the existing codebase already unions the two clients loosely.

### 5.3 `InsertBuilder` (`src/core/insert-builder.ts`)

Immutable, matching the QueryBuilder convention (every mutator returns a new instance):

```ts
export class InsertBuilder<
  Schema extends SchemaDefinition<Schema>,
  Table extends Extract<keyof Schema, string>,
  Row extends Record<string, unknown> = InsertRow<Schema[Table]>
> {
  // ctor: (tableName: string, adapter: DatabaseAdapter)
  // private: rows: Row[], columnList?: string[], clickhouseSettings?: ClickHouseSettings

  columns<K extends Extract<keyof Schema[Table], string>>(
    columns: readonly K[]
  ): InsertBuilder<Schema, Table, InsertRowForColumns<Schema[Table], K>>;
  // Must be called before values(); throw if rows already set.
  // Stores columnList for the adapter (ClickHouse fills DEFAULTs for omitted cols).

  values(rows: Row | Row[]): InsertBuilder<Schema, Table, Row>;
  // Accumulates (concat) so .values(a).values(b) works; normalize to array.

  settings(settings: ClickHouseSettings): InsertBuilder<Schema, Table, Row>;

  async execute(options?: { queryId?: string }): Promise<InsertResultSummary>;
}
```

`execute()` behavior:

1. Throw if no rows: `Error('No values provided. Call .values() before .execute().')`
2. Throw if `!adapter.insert` (message in §5.1).
3. **Normalize rows** (pure function, export it for testing — `normalizeInsertRows`):
   - `Date` → `toISOString()` (works for both Date and DateTime columns under best_effort parsing).
   - `bigint` → `String(v)`.
   - Recurse into arrays and plain objects (Map columns are plain objects in JSONEachRow); leave everything else untouched. Depth-limit not needed at runtime, but skip prototype-less edge cases — a simple recursive walk over `Array.isArray` / `Object.getPrototypeOf(v) === Object.prototype || null` is fine.
4. Log via `logger.logQuery` with the same started/completed/error triple used in `executor.ts` (use a synthetic query string like `INSERT INTO <table> (<cols>) FORMAT JSONEachRow /* N rows */` for the log — do not serialize row data into logs).
5. Call `adapter.insert(table, normalizedRows, { clickhouseSettings, queryId, columns })` and return its result.

No caching involvement — inserts bypass `executeWithCache` entirely. (Deliberate v1 simplification: we do not invalidate the read cache on insert; ClickHouse analytics workloads tolerate this and cache entries have TTLs. Mention in docs.)

### 5.4 Factory wiring (`query-builder.ts`)

In the object returned by `createQueryBuilder` (after `rawQuery`, before `table`):

```ts
insertInto<TableName extends Extract<keyof Schema, string>>(
  tableName: TableName
): InsertBuilder<Schema, TableName> {
  return new InsertBuilder<Schema, TableName>(tableName, resolvedAdapter);
},
```

Do **not** touch the `QueryBuilder` class itself — it is a SELECT pipeline (its state machine, dialect compilation, and cache layer are all select-shaped). Inserts are a sibling builder.

---

## 6. Exports

`src/index.ts`:

```ts
export { InsertBuilder } from './core/insert-builder.js';
export type { InsertRow, InsertValue, InsertRowForColumns } from './types/insert.js';
export type { InsertExecutionOptions, InsertResultSummary } from './core/adapters/database-adapter.js';
```

Update `src/core/tests/public-exports.test.ts` accordingly (it asserts the export surface).

Per project convention (see memory / release history): this is additive — nothing is removed or renamed, no deprecations needed.

---

## 7. Tests

### 7.1 Type tests — `type-tests/insert-types.test.ts`

Use `TEST_SCHEMAS` / `TestSchema` from `src/core/tests/test-utils.js` and the `Expect<Equal<...>>` + `@ts-expect-error` conventions from `type-tests/query-builder-types.test.ts`. The type-test suite runs via `npm run test:types` (plain `tsc`, `tsconfig.type-tests.json`). Cover at minimum:

- `InsertRow<TestSchema['test_table']>` marks `optional_name` and `optional_tags` optional, everything else required.
- Value widening: `created_at` (Date col) accepts `string | Date`; `created_timestamp` (`DateTime64(9)`) accepts `Date`; `is_premium` accepts `boolean` only; `metadata` requires `Record<string, string>`; `tags` requires `string[]`.
- `@ts-expect-error` cases: unknown table in `insertInto`, missing required column, wrong value type, unknown column in literal, `columns(['nope'])`, value containing a column outside the `columns()` subset.
- `Awaited<ReturnType<...execute>>` equals `InsertResultSummary`.

Note: `test-utils.ts` is inside `src/core/tests/`, which `tsconfig.type-tests.json` *excludes* from `include` but type-tests already import from it (see existing `query-builder-types.test.ts` line 4) — so this works as-is; don't fight it.

### 7.2 Unit tests — `src/core/tests/insert-builder.test.ts` (vitest)

Mock adapter capturing calls:

```ts
const captured: { table?: string; rows?: unknown[]; options?: InsertExecutionOptions } = {};
const adapter: DatabaseAdapter = {
  name: 'test',
  query: async () => { throw new Error('not used'); },
  insert: async (table, rows, options) => {
    Object.assign(captured, { table, rows, options });
    return { queryId: 'q1', executed: true };
  },
};
const db = createQueryBuilder<TestSchema>({ adapter });
```

Cases:
1. Single object and array both reach the adapter as arrays; chained `.values().values()` concatenates.
2. Normalization: `Date` → ISO string; `bigint` → string; nested `Date` inside an `Array(...)` value and inside a Map object; non-Date/bigint values pass through unchanged (`normalizeInsertRows` can also be tested directly).
3. `.columns(['id','name'])` forwards `options.columns`.
4. `.settings({...})` forwards to `options.clickhouseSettings`; `execute({ queryId })` forwards queryId.
5. Empty `.execute()` (no values) throws.
6. Adapter without `insert` throws the "not supported" message.
7. Immutability: calling `.values()` on a base builder doesn't mutate the base (matching QueryBuilder semantics).
8. Adapter errors propagate and are logged with `status: 'error'` (subscribe via `logger` like existing logging tests, if any — check `core/utils/logger.ts` for the subscription API before writing this).

### 7.3 Integration test (optional but recommended)

There is an integration harness (`npm run test:integration`, `vitest.integration.config.ts`, `testing/clickhouse/harness.mjs`). Add one test: create a table with a Nullable column and a DEFAULT column, insert via `insertInto` (full row + `columns()` subset), select back and assert values/defaults/null handling, and a `DateTime64` round-trip from a `Date` object. Follow the setup/teardown pattern of the existing integration specs (look in the integration config's include glob to find them).

Run order for verification: `npm run test:types && npm run test:unit` in `packages/clickhouse`, then `npm run build` (the build runs a verify step). Run integration only if a local ClickHouse is available (the script skips/fails gracefully — check `scripts/run-integration-tests.js` behavior before assuming).

---

## 8. Docs & changeset

- **Changeset:** `.changeset/<name>.md`, `"@hypequery/clickhouse": minor`, summary: "Add type-safe insert API: `db.insertInto(table).values(rows).execute()`".
- **Docs page:** add `website-next/docs/inserts.mdx` (match frontmatter/format of e.g. `website-next/docs/schemas.mdx`; register it wherever the docs nav is defined — search `website-next` for how `schemas` is listed, likely a `meta.json`). Content: quick start, nullable-vs-required semantics, `columns()` + DEFAULTs, Date/bigint handling, async_insert settings example, cache-not-invalidated note, "adapter must implement insert" note for custom adapters.
- Mention the new method in the query-builder API docs if there's a generated/typedoc surface (`npm run docs:api` uses typedoc — TSDoc comments on the public methods are the input, so write proper TSDoc with `@example` blocks on `insertInto`, `InsertBuilder` methods).

---

## 9. Known limitations / phase 2 (document, don't build)

1. **Defaulted columns are still required** unless `.columns()` is used — schema literals don't carry DEFAULT metadata. Phase 2: extend `generate-types` to emit e.g. `{ __defaults?: 'col1' | 'col2' }` or a parallel `IntrospectedInsertSchema`, and make those keys optional.
2. **Streaming inserts** (`values: Readable`) — node-only; add `insertStream` later rather than complicating `values()`.
3. **`INSERT INTO ... SELECT`** — `insertInto(t).fromSelect(qb)` compiling the select via the existing dialect; clean fit later because the select side already compiles to SQL text.
4. **SQL-fallback inserts for adapters without native insert** — would require a real ClickHouse literal formatter (current `escapeValue` is wrong for arrays/maps — see §2.3). Only worth it if an embedded-engine adapter needs it.
5. **Cache invalidation on insert** — deliberately skipped (TTL-based cache).

---

## 10. Acceptance checklist

- [ ] `db.insertInto('t').values(row).execute()` inserts via native client `JSONEachRow` with `date_time_input_format: 'best_effort'` defaulted.
- [ ] All compile-time error cases in §1 fail type-check (proven by `@ts-expect-error` type tests).
- [ ] `Nullable(...)` and `LowCardinality(Nullable(...))` columns optional; all others required.
- [ ] `Date` and `bigint` values normalized before hitting the client (JSON.stringify would otherwise throw on bigint).
- [ ] Custom adapters without `insert` get a clear runtime error; `DatabaseAdapter.insert` stays optional (no breaking change for existing adapter implementations).
- [ ] QueryBuilder class, dialect, cache layer untouched.
- [ ] Exports added + `public-exports.test.ts` updated; type tests, unit tests, build all green.
- [ ] Changeset (minor) + docs page added.

# @hypequery/postgres — Manual Testing Spec

A self-contained plan for running hypequery datasets on Postgres, written so it can be
handed to an agent/model and executed end to end **against a real, already-populated
Postgres you provide**. There is **no data seeding**: the model introspects the schema,
picks suitable tables and columns, defines datasets over them, and verifies every result
against **ground truth computed with hand-written Postgres SQL** over the same rows.

It builds one inspectable app under `hq-postgres-test/` (dataset definitions, a `sql/`
dump of every compiled statement, and a vitest suite).

- **Packages under test:** `@hypequery/postgres`, `@hypequery/datasets`, `@hypequery/cli`
- **Surfaces reused:** `@hypequery/serve`, `@hypequery/mcp`, `@hypequery/react`
- **Docs covered:** `datasets/postgres`, `reference/api/cli` (`init`, `generate:datasets`, `check`)
- **Read-only.** Nothing here creates, alters or writes a table. Every check that needs
  a table uses one that already exists.

> **Ground-truth method.** Each value assertion runs the equivalent hand-written SQL
> through `pg` directly (not through hypequery) and compares it with the dataset result.
> The dataset layer is correct iff its output matches. No magic numbers.

---

## 0. Prerequisites & discovery

### 0.1 Connection
- Node ≥ 18, `tsx`, `vitest`, and Postgres 14 or newer.
- Set `DATABASE_URL=postgres://user:password@host:5432/db`. A read-only role is enough
  and preferred; note in Appendix B whether the role is a superuser and whether the
  server is a primary (`SELECT pg_is_in_recovery()` is `false`).

### 0.2 Create the app with the CLI
```bash
mkdir hq-postgres-test && cd hq-postgres-test && npm init -y
DATABASE_URL=… npx hypequery init --database postgres --no-interactive --all-tables
```

- **P0.1** `init` reports a successful connection and the table count, and says when the
  server is a primary. It writes `analytics/client.ts` (a `createPostgresQueryBuilder`
  client), `analytics/datasets.ts` and `.env` with `DATABASE_URL`. No `schema.ts` is
  written.
- **P0.2** `npx hypequery generate:datasets --database postgres --diff` reports no
  changes immediately after `init`.
- **P0.3** Every single-column foreign key in the schema appears as a `belongsTo`
  relationship in `datasets.ts`. Cross-check with
  `SELECT conrelid::regclass, confrelid::regclass FROM pg_constraint WHERE contype = 'f' AND array_length(conkey, 1) = 1`.
  Tables outside `public` are named `schema_table`.
- **P0.4** `npx hypequery check analytics/api.ts` plans every dataset and exits 0.
  Rename one measure's column in `datasets.ts` to a column that doesn't exist, rerun,
  and confirm it exits 1, naming that measure and quoting Postgres's
  `column … does not exist`. Revert the change.

### 0.3 Choose the target table
Pick the table with the most rows that has at least one `timestamptz` (or `timestamp`)
column, one numeric column and one low-cardinality text column. Prefer one with a
foreign key to another table. Record the choice and its row count in Appendix B. Call
the columns `T` (time), `N` (numeric), `C` (category) below.

### 0.4 Files to create
```
hq-postgres-test/
  src/client.ts        # pg.Pool + createPostgresQueryBuilder + createDatasetClient
  src/target.ts        # hand-written dataset over the target table
  src/truth.ts         # rawSql(text, values) via pg, never via hypequery
  sql/                 # one file per compiled statement (compileDataset(...).sql)
  test/postgres.test.ts
```

`src/client.ts` follows the docs exactly:

```ts
import pg from 'pg';
import { createDatasetClient } from '@hypequery/datasets';
import { createPostgresQueryBuilder } from '@hypequery/postgres';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export const db = createPostgresQueryBuilder({ pool });
export const analytics = createDatasetClient({ queryBuilder: db });
```

---

## 1. Aggregates against ground truth

- **P1.1** `sum`, `count`, `countDistinct`, `avg`, `min`, `max` over `N`, grouped by
  `C`, match `SELECT C, SUM(N), COUNT(N), COUNT(DISTINCT N), AVG(N), MIN(N), MAX(N) … GROUP BY C`.
  Compare numbers with a relative tolerance of 1e-9; `bigint` results arrive as strings.
- **P1.2** `percentile(0.9)` matches `percentile_cont(0.9) WITHIN GROUP (ORDER BY N)`;
  `stddev`/`variance` match `stddev_samp`/`var_samp` (one-row groups are `null`).
- **P1.3** A filtered measure (`measure.sum(N, { filters: [eq(C, '<value>')] })`) matches
  `SUM(N) FILTER (WHERE C = '<value>')`, and is `0`, not `null`, for a group with no
  matching rows.
- **P1.4** A derived ratio of two integer counts is fractional (Postgres would truncate
  `int / int`), and a zero denominator gives `null`, not an error.
- **P1.5** Ordering by a measure puts `NULL`s last in both directions.

## 2. Time

- **P2.1** For each grain (`hour`, `day`, `week`, `month`, `quarter`, `year`) with
  `timezone: 'America/New_York'`, buckets and counts match
  `date_trunc(grain, T, 'America/New_York')` grouped and counted in raw SQL. Weeks start
  on **Sunday**: compare with `date_trunc('week', T + interval '1 day', zone) - interval '1 day'`.
- **P2.2** Period labels are `YYYY-MM-DD HH:MM:SS` for sub-day grains and `YYYY-MM-DD`
  for `week` and coarser.
- **P2.3** If the data spans a DST fall-back night, the repeated hour is **two**
  buckets in `hour` grain. Otherwise record "not covered" in Appendix B.
- **P2.4** A time filter (`gte` on `T`) returns the same rows as the raw predicate, and
  `EXPLAIN` of the compiled SQL (dump it to `sql/`) compares the bare column `T`, so an
  index on `T` is usable.
- **P2.5** A trailing time measure (`measure.trailing('<sum measure>', { amount: 7, unit: 'day' })`),
  queried `by: 'day'` with one bounded filter pair on `T` (`gte` and `lt` a month apart),
  matches a raw window sum over the same 7-day ranges, including the days before the
  filter's start that the window reads.

## 3. Relationships

- **P3.1** Using a generated `belongsTo`, a related dimension (`rel.column`) grouped
  with a base measure matches a raw `LEFT JOIN`.
- **P3.2** The compiled SQL uses `LEFT JOIN LATERAL (… LIMIT 1)`, so the base measure's
  total equals the ungrouped total: no fan-out.

## 4. Raw SQL and safety

- **P4.1** A raw `sql` dimension using Postgres syntax (`upper(C)`, `C || '-x'`)
  works. One containing `;`, `--` or `/*` outside a literal is refused when the
  dataset is defined. One containing `$` outside a literal (`$$…$$`, `$1`) is refused
  on Postgres: by `createAPI` at startup, or by the first query that plans it. The error
  names the field and says why.
- **P4.2** Every query runs read-only: `db.rawQuery("SELECT current_setting('transaction_read_only') AS ro")`
  returns `on`.
- **P4.3** `createPostgresQueryBuilder({ pool, statementTimeoutMs: 50 })` makes
  `db.rawQuery('SELECT pg_sleep(1)')` fail with a statement-timeout error.
- **P4.4** `maxRows: 10` makes a query returning 11 rows fail as too large, and the error
  arrives without the server sending the rest: time it against the full result.
- **P4.5** An aborted `AbortSignal` cancels the statement on the server: during
  `pg_sleep(5)`, `pg_stat_activity` shows the backend gone within a second of `abort()`.
- **P4.6** `searchPath: ['<target schema>']` lets an unqualified source name resolve,
  and `current_setting('search_path')` reads `pg_catalog, "<schema>", pg_temp`.

## 5. Surfaces

Run the [Serve](./serve-testing-spec.md), [MCP](./mcp-testing-spec.md) and
[React](./react-testing-spec.md) journeys with `queryBuilder: db` from §0.4 in place of
the ClickHouse builder, using the target dataset from §1. Record any step that is
ClickHouse-specific (for example, `final: true` or `measure.merge`) as **N/A — refused
on Postgres** after confirming `createAPI` refuses it at startup with a message naming
the dataset.

- **P5.1** Serve's dataset endpoint returns the same rows as `analytics.execute`.
- **P5.2** MCP tool calls return the same rows.
- **P5.3** The React hooks render the same values.

## 6. Moving to ClickHouse (optional)

If a ClickHouse with the same rows is available (`CLICKHOUSE_*` set), swap the builder
for `createQueryBuilder(…)` from `@hypequery/clickhouse` without touching the datasets,
rerun §1 to §3, and confirm the results are identical. Record differences in Appendix A.

---

## Appendix A — Doc/code discrepancies

Record every mismatch between `datasets/postgres` (or the CLI reference) and observed
behaviour here, as doc bugs to file, separate from pass/fail.

| # | Where | Docs say | Observed |
|---|---|---|---|
| | | | |

## Appendix B — Run record

| Item | Value |
|---|---|
| Postgres version | |
| Primary or replica | |
| Role is superuser | |
| Target table and row count | |
| DST fall-back covered (P2.3) | |
| ClickHouse comparison run (§6) | |

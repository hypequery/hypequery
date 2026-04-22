# `@hypequery/clickhouse` Migrations

## Revised Technical Specification

## Summary

`@hypequery/clickhouse` migrations extends hypequery from a schema-introspection and query-layer product into a TypeScript-native ClickHouse schema management workflow.

The feature is **not** a generic SQL file runner. Its strategic value is narrower and sharper:

- TypeScript-owned ClickHouse schema definitions
- generated, reviewable SQL migrations
- safe default handling for ClickHouse-specific schema evolution
- first-class automation for **materialized view dependency sequencing**

That last point is the v1 differentiator. If hypequery cannot safely manage source-table changes when dependent materialized views exist, the product collapses toward commodity migration tooling.

## Strategic Positioning

### Why build this

hypequery already claims a TypeScript-native workflow for ClickHouse. Today that workflow begins after schema creation: users introspect a live database, generate types, then build queries and APIs.

Migrations moves hypequery earlier in the lifecycle:

1. define schema in TypeScript
2. generate and review SQL migrations
3. apply migrations to ClickHouse
4. use the same schema definitions to power type-safe queries

This turns hypequery from a typed analytics layer into a broader ClickHouse developer platform.

### What makes this strategically sound

This feature is only strategically sound if it reinforces hypequery's existing thesis rather than competing with generic migration tools on generic functionality.

The core product claim for v1 is:

> The safest TypeScript workflow for evolving real ClickHouse schemas, especially when materialized views are involved.

### What this is not

- not a generic migration framework for many databases
- not a full ClickHouse operations platform
- not a transactional migration system
- not a replacement for custom SQL when users need bespoke data movement or rebuilds

## Design Principles

### Code-first schema ownership

The TypeScript schema file is the source of truth. Developers edit TypeScript, not generated SQL.

### ClickHouse-native, not SQL-generic

The system should encode ClickHouse realities directly: engines, ordering keys, materialized views, cluster clauses, and non-transactional DDL.

### Differentiation through dependency handling

Materialized view dependency sequencing is in scope for v1 even if other areas are narrowed. It is the clearest reason for this feature to exist.

### Safe-by-default for destructive work

Potentially destructive or rewrite-heavy operations require explicit acknowledgement. Some classes of changes remain unsupported in generated migrations until a later version.

### Generated SQL remains reviewable

Migration files are plain SQL, designed to be committed and code-reviewed.

### Progressive adoption

Existing ClickHouse users can baseline their current schema and adopt the system incrementally.

## Product Shape

### Package boundaries

The implementation should follow the existing monorepo split:

- `@hypequery/clickhouse`
  - schema DSL
  - config types
  - snapshot serializer
  - diff engine
  - SQL generator
  - introspection utilities
- `@hypequery/cli`
  - `generate`
  - `migrate`
  - `push`
  - `pull`
  - `status`
  - `check`
  - `drop`
  - future `reconcile`

The schema and migration logic belongs in `@hypequery/clickhouse`. The end-user command surface remains in `@hypequery/cli`.

## Architecture

### Four-phase pipeline

#### 1. Schema Serialization

Schema definitions are evaluated from TypeScript and serialized into a normalized JSON snapshot representing the desired ClickHouse state.

#### 2. Snapshot Diffing

The current desired snapshot is compared against the latest saved snapshot in `migrations/meta/`. The diff engine emits typed change operations.

#### 3. SQL Generation

Typed change operations are converted into ClickHouse DDL. ClickHouse-specific behavior lives here, including dependency-aware sequencing.

#### 4. Migration Execution

Generated migration files are applied in order. Applied state is stored in a `_hypequery_migrations` table.

## Configuration

The migration system requires a real config contract rather than today's heuristic file discovery.

```ts
import { defineConfig } from '@hypequery/clickhouse'

export default defineConfig({
  dialect: 'clickhouse',
  schema: './src/schema.ts',
  migrations: {
    out: './migrations',
    table: '_hypequery_migrations',
    prefix: 'timestamp',
  },
  dbCredentials: {
    host: process.env.CLICKHOUSE_HOST!,
    username: process.env.CLICKHOUSE_USER!,
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
    database: 'analytics',
  },
  cluster: {
    name: 'main_cluster',
  },
})
```

### Config requirements

- deterministic schema entrypoint
- deterministic migration output directory
- explicit migration table name
- optional cluster configuration
- env-backed DB credentials

## Schema Definition API

The new migration system requires a richer schema AST than today's introspected `IntrospectedSchema`.

Illustrative shape:

```ts
import {
  defineSchema,
  defineTable,
  defineMaterializedView,
  column,
  sql,
} from '@hypequery/clickhouse'

export const orders = defineTable('orders', {
  engine: {
    type: 'MergeTree',
    orderBy: ['created_at', 'user_id'],
    partitionBy: sql`toYYYYMM(created_at)`,
  },
  columns: {
    id: column.UInt64(),
    user_id: column.UInt64(),
    total: column.Decimal(10, 2),
    status: column.LowCardinality('String').default('pending'),
    created_at: column.DateTime(),
  },
  settings: {
    index_granularity: 8192,
  },
})

export const ordersByDay = defineMaterializedView('orders_by_day', {
  from: orders,
  to: 'orders_daily_summary',
  select: sql`
    SELECT
      toDate(created_at) AS day,
      sum(total) AS revenue,
      count() AS order_count
    FROM orders
    GROUP BY day
  `,
})

export default defineSchema({
  tables: [orders],
  materializedViews: [ordersByDay],
})
```

## Snapshot Model

The snapshot must model more than columns.

### Minimum v1 snapshot coverage

- tables
- columns
- defaults
- nullability
- engines
- `ORDER BY`
- `PARTITION BY`
- settings
- materialized views
- dependencies between source tables and views
- optional cluster metadata

### Deferred snapshot coverage

- projections
- skipping indices
- dictionaries
- complex TTL policies
- broad engine-specific edge cases not needed for v1 workflows

## Diff Engine

The diff engine emits typed changes rather than generating SQL directly.

### Required v1 operation types

- `CreateTable`
- `DropTable`
- `AddColumn`
- `DropColumn`
- `ModifyColumnDefault`
- `CreateMaterializedView`
- `DropMaterializedView`
- `RecreateMaterializedView`
- `AlterTableWithDependentViews`

### Optional v1 operation types

- `ModifyColumnType` with warnings and explicit confirmation
- `ModifySettings`

### Out of automated generation in v1

- sorting key changes requiring table recreation
- primary-key/order-key rebuild recipes
- arbitrary backfills
- complex table-copy swaps

## Materialized View Dependency Sequencing

This is the defining v1 feature.

When a source table change affects a dependent materialized view, SQL generation must sequence operations correctly:

1. detect dependent materialized views
2. capture their current definitions
3. drop or detach dependent views in safe order
4. apply the table alteration
5. recreate the affected materialized views

Illustrative output:

```sql
DROP TABLE orders_by_day;

ALTER TABLE orders ADD COLUMN region LowCardinality(String);

CREATE MATERIALIZED VIEW orders_by_day
TO orders_daily_summary AS
SELECT
  toDate(created_at) AS day,
  region,
  sum(total) AS revenue,
  count() AS order_count
FROM orders
GROUP BY day, region;
```

### v1 limits

The first release should support deterministic sequencing for materialized views defined through hypequery's schema system.

It does not need to fully support:

- manually created external views unknown to the snapshot
- arbitrary dependency chains spanning unmanaged objects
- data backfill or replay semantics after view recreation

If unmanaged dependent objects are detected, generation should stop and require explicit custom SQL.

## CLI Surface

```bash
npx hypequery generate [--name <migration-name>]
npx hypequery migrate
npx hypequery push
npx hypequery pull
npx hypequery status
npx hypequery check
npx hypequery drop
```

### Command intent

- `generate`
  - load config
  - load schema
  - compare desired snapshot to latest snapshot
  - write migration directory with `up.sql`, optional `down.sql`, and `meta.json`
- `migrate`
  - apply pending migrations in order
  - record checksum and metadata
- `push`
  - dev-only fast path
  - compute SQL and apply without writing migration files
- `pull`
  - introspect live DB
  - emit TypeScript schema baseline plus initial snapshot
- `status`
  - show applied and pending migrations
- `check`
  - verify applied migration checksums
- `drop`
  - remove latest unapplied migration

## Migration File Format

```text
migrations/
├── 20260422140000_add_orders_table/
│   ├── up.sql
│   ├── down.sql
│   └── meta.json
└── meta/
    ├── _journal.json
    └── 0000_snapshot.json
```

### `down.sql` policy

`down.sql` is **best-effort** in v1, not universally guaranteed.

Safe generated downs:

- drop newly created tables
- drop newly created materialized views
- remove newly added columns where the inverse is straightforward

Unsafe or unsupported downs:

- type rewrites
- data mutations
- table recreation flows
- any operation where inversion may destroy data or fail nondeterministically

In those cases, the generator should emit either:

- no `down.sql`, or
- a stub file with clear manual instructions

## Custom SQL Migrations

Custom migrations remain an escape hatch:

```bash
npx hypequery generate --custom --name backfill_user_regions
```

### v1 tradeoff

Custom migrations bypass the diff engine. They are tracked and checksummed, but the schema snapshot is not automatically advanced to reflect arbitrary raw SQL.

That means custom migrations can create drift relative to the desired schema state.

### Required UX guardrails

The docs and CLI must make the reconciliation model explicit:

- after custom migrations, rerun `pull` or a future snapshot reconciliation flow if the schema state changed
- drift detection should warn when live schema diverges from recorded snapshots

## State Tracking

Applied migrations are tracked in a ClickHouse table:

```sql
CREATE TABLE _hypequery_migrations (
  id UInt64,
  name String,
  checksum String,
  applied_at DateTime DEFAULT now(),
  applied_by String DEFAULT ''
) ENGINE = MergeTree
ORDER BY id;
```

## Adoption Path

Existing users adopt through `pull`:

1. introspect the current ClickHouse schema
2. generate TypeScript schema definitions
3. write baseline snapshot to `migrations/meta/0000_snapshot.json`
4. begin managing future changes through TypeScript and generated migrations

No initial migration file is required for the baseline.

## Safety Model

### Safe-by-default generated changes in v1

- create table
- add column
- create materialized view
- dependency-aware source-table alteration with managed view recreation

### Warn-and-confirm changes in v1

- drop column
- drop table
- modify column type
- engine or settings changes that may trigger large rewrites

### Unsupported generated changes in v1

- sort-key changes requiring copy/swap flows
- generalized data migrations
- replication-lag coordination
- partial recovery from complex failed multi-step rebuilds

## Scope

### In scope for v1

- config loading via `defineConfig`
- TypeScript-owned ClickHouse schema definitions
- snapshot serialization
- typed diff engine
- generated SQL migrations
- migration state tracking
- materialized view dependency sequencing for managed views
- baseline introspection with `pull`
- custom SQL migrations

### Deferred beyond v1

- broad engine completeness beyond the initial supported set
- projections and skipping indices
- sort-key rebuild automation
- advanced replicated/distributed orchestration
- team locking and approval workflows
- generalized reconciliation tooling

### Explicitly out of scope

- non-ClickHouse databases
- row-level CRUD
- transactional guarantees over DDL
- automated data backfill planning

## Success Criteria

The feature is successful if a TypeScript team can:

1. define a real ClickHouse schema in code
2. generate reviewable SQL migrations
3. safely evolve a source table with dependent materialized views
4. apply and track migrations in ClickHouse
5. keep schema definitions, migration history, and query-layer types aligned

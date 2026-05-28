# @hypequery/schema

Type-safe schema migrations for ClickHouse with intelligent diff detection, cost-aware planning, and automatic materialized view handling.

[![npm version](https://img.shields.io/npm/v/@hypequery/schema.svg)](https://www.npmjs.com/package/@hypequery/schema)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

## Features

- **Declarative Schema DSL** - Define tables and materialized views in TypeScript
- **Snapshot-Based Migrations** - Generate migrations by diffing schema snapshots
- **Cost-Aware Planning** - Analyze table statistics and estimate migration costs
- **Safe MV Handling** - Automatically drop/recreate materialized views around table alterations
- **Type Safety** - Full TypeScript type inference and validation
- **Interactive Confirmations** - Prompts for destructive operations with `--force` bypass
- **Dataset Compatibility** - Validate semantic layer compatibility with schema changes

## Installation

```bash
npm install @hypequery/schema
# or
pnpm add @hypequery/schema
```

## Quick Start

### 1. Define Your Schema

```typescript
// src/schema.ts
import { defineSchema, defineTable, defineMaterializedView, column, sql } from '@hypequery/schema';

export const users = defineTable('users', {
  columns: {
    id: column.UInt64(),
    email: column.String(),
    name: column.String().nullable(),
    status: column.LowCardinality('String').default('active'),
    created_at: column.DateTime(),
  },
  engine: {
    type: 'MergeTree',
    orderBy: ['created_at', 'id'],
    partitionBy: sql`toYYYYMM(created_at)`,
  },
  settings: {
    index_granularity: 8192,
  },
});

export const orders = defineTable('orders', {
  columns: {
    id: column.UInt64(),
    user_id: column.UInt64(),
    amount: column.Decimal(10, 2),
    status: column.String(),
    created_at: column.DateTime(),
  },
  engine: {
    type: 'MergeTree',
    orderBy: ['created_at', 'id'],
  },
});

export const ordersByDay = defineMaterializedView('orders_by_day', {
  from: orders,
  to: 'orders_daily_summary',
  engine: {
    type: 'AggregatingMergeTree',
    orderBy: ['day'],
  },
  select: sql`
    SELECT
      toDate(created_at) AS day,
      sum(amount) AS total_amount,
      count() AS order_count
    FROM orders
    GROUP BY day
  `,
});

export default defineSchema({
  tables: [users, orders],
  materializedViews: [ordersByDay],
});
```

### 2. Configure Migrations

```typescript
// hypequery.config.ts
import { defineConfig } from '@hypequery/schema';

export default defineConfig({
  dialect: 'clickhouse',
  schema: './src/schema.ts',
  migrations: {
    out: './migrations',
    table: '_hypequery_migrations',
  },
  dbCredentials: {
    host: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
    username: process.env.CLICKHOUSE_USERNAME || 'default',
    password: process.env.CLICKHOUSE_PASSWORD || '',
    database: process.env.CLICKHOUSE_DATABASE || 'default',
  },
});
```

### 3. Generate Migrations

```bash
# Generate migration from schema changes
hypequery generate:migration add_orders_table

# With interactive safety prompts disabled (for CI/CD)
hypequery generate:migration add_orders_table --force

# Skip database cost analysis for speed
hypequery generate:migration add_orders_table --skip-cost-analysis
```

### 4. Apply Migrations

```bash
# Deploy pending migrations
hypequery migrate:deploy

# Check migration status
hypequery migrate:status

# Verify migration integrity
hypequery migrate:check
```

## Column Types

### Numeric Types

```typescript
column.Int8()       column.Int16()      column.Int32()      column.Int64()
column.Int128()     column.Int256()
column.UInt8()      column.UInt16()     column.UInt32()     column.UInt64()
column.UInt128()    column.UInt256()
column.Float32()    column.Float64()
column.Decimal(precision, scale)
column.Bool()       column.Boolean()
```

### String Types

```typescript
column.String()
column.FixedString(length)
```

### Date/Time Types

```typescript
column.Date()
column.Date32()
column.DateTime(timezone?)
column.DateTime64(precision, timezone?)
```

### Other Types

```typescript
column.UUID()
column.IPv4()
column.IPv6()
column.JSON()
column.Raw('CustomType<Param>')  // For introspected or custom types
```

### Type Modifiers

```typescript
// Make nullable
column.String().nullable()

// Low cardinality optimization
column.String().lowCardinality()

// Set default value
column.String().default('pending')           // Literal
column.DateTime().default(sql`now()`)        // SQL expression
column.UInt64().default(0)

// Chain modifiers
column.String().lowCardinality().nullable().default('active')
```

### Alternative Syntax

```typescript
// Using wrapper functions
column.Nullable('String')
column.LowCardinality('String')
column.Nullable(column.LowCardinality('String'))
```

## Migration Workflows

### Schema-First Development

```
1. Define schema in TypeScript using DSL
      ↓
2. Generate snapshot from schema
      ↓
3. Diff current snapshot vs previous
      ↓
4. Plan migration with cost analysis
      ↓
5. Render SQL (up.sql and down.sql)
      ↓
6. Review and deploy migration
```

### Materialized View Safety

When altering tables with dependent materialized views:

```sql
-- Generated migration automatically handles MV dependencies:
DROP VIEW orders_by_day;

ALTER TABLE orders ADD COLUMN region String;

-- Recreate view with updated schema
CREATE MATERIALIZED VIEW orders_by_day ...
```

### Cost-Aware Planning

Migrations analyze table statistics and warn about expensive operations:

```
⚠ Migration contains operations that require review:

  ⚠ Operation "ModifyColumnType" may trigger a ClickHouse mutation.
     Review table size and mutation impact before applying.
  ⚠ Table "orders" has 1.2B rows (450 GB).
     This mutation may take significant time.

? This migration will trigger ClickHouse mutations. Continue? (y/N)
```

### Interactive Confirmations

Destructive operations require explicit confirmation:

```bash
# Prompts for confirmation
hypequery generate:migration drop_old_field

⚠ Migration contains operations that require review:
  ⚠ Operation drops column users.deprecated_field.

? This migration includes 1 destructive operation(s). Continue? (y/N)

# Skip prompts in CI/CD
hypequery generate:migration drop_old_field --force
```

## Advanced Usage

### Custom SQL Migrations

For operations that can't be auto-generated:

```bash
# Create custom migration
hypequery generate:migration backfill_user_data --custom

# Edit migrations/20260527_backfill_user_data/up.sql
# Write custom SQL, then deploy
hypequery migrate:deploy
```

### Baseline from Existing Database

Pull current schema as baseline migration:

```bash
hypequery pull
```

### Dataset Compatibility Checks

Validate semantic layer compatibility:

```typescript
import { checkDatasetsAgainstSchema } from '@hypequery/schema';

const report = checkDatasetsAgainstSchema({
  snapshot: currentSnapshot,
  datasets: [ordersDataset, customersDataset],
});

if (!report.valid) {
  console.log('Breaking changes detected:', report.diagnostics);
}
```

## API Reference

### Schema Definition

#### `defineSchema(definition)`

Creates a schema AST from tables and materialized views.

**Parameters:**
- `definition.tables`: Array of table definitions
- `definition.materializedViews?`: Array of materialized view definitions

**Returns:** `ClickHouseSchemaAst`

#### `defineTable(name, definition)`

Defines a ClickHouse table.

**Parameters:**
- `name`: Table name (string)
- `definition.columns`: Record of column definitions
- `definition.engine`: Engine configuration (type, orderBy, partitionBy, etc.)
- `definition.settings?`: Table settings (index_granularity, etc.)

**Returns:** `ClickHouseTableDefinition`

#### `defineMaterializedView(name, definition)`

Defines a materialized view with source dependencies.

**Parameters:**
- `name`: View name (string)
- `definition.from`: Source table reference
- `definition.to?`: Target table name (for data-retaining MVs)
- `definition.engine?`: Engine configuration (for data-retaining MVs)
- `definition.select`: SQL SELECT statement

**Returns:** `ClickHouseMaterializedViewDefinition`

#### `column` Object

Factory helpers for column types. Each type returns a `ClickHouseColumnBuilder` with methods:
- `.default(value)` - Set default value (literal or SQL expression)
- `.nullable()` - Make column nullable
- `.lowCardinality()` - Apply LowCardinality optimization

#### `sql` Template Tag

Tagged template for SQL expressions:

```typescript
sql`toYYYYMM(${columnName})`
sql`now()`
sql`multiIf(status = 'active', 1, 0)`
```

### Configuration

#### `defineConfig(config)`

Defines migration configuration with type preservation.

**Parameters:**
- `config.dialect`: Database dialect ('clickhouse')
- `config.schema`: Path to schema file
- `config.migrations`: Migration settings (out, table, prefix)
- `config.dbCredentials?`: Database connection credentials
- `config.cluster?`: Cluster configuration for distributed DDL

**Returns:** `HypequeryClickHouseConfig`

### Snapshot System

#### `serializeSchemaToSnapshot(schema)`

Converts schema AST to stable snapshot.

**Returns:** `Snapshot` with tables, materializedViews, dependencies, and contentHash

#### `snapshotToStableJson(snapshot)`

Converts snapshot to deterministic JSON string.

#### `hashSnapshot(snapshot)`

Generates SHA-256 content hash for snapshot.

### Diff Engine

#### `diffSnapshots(previous, next)`

Compares two snapshots and generates migration operations.

**Returns:** `SnapshotDiffResult` containing:
- `operations`: Array of migration operations
- `warnings`: Array of warnings (type changes, etc.)
- `unsupportedChanges`: Array of unsupported changes requiring custom migrations

### Migration Planning

#### `createMigrationPlan(diff, options?)`

Creates migration plan with cost estimates and safety checks.

**Parameters:**
- `diff`: Result from `diffSnapshots()`
- `options.context?`: Table statistics for cost estimation
- `options.requireConfirmationForMutations?`: Enable mutation confirmations (default: false)

**Returns:** `MigrationPlan` containing:
- `operations`: Classified operations with risk levels
- `diagnostics`: Warnings and errors
- `blockers`: Operations preventing migration generation
- `requiredConfirmations`: Operations requiring user confirmation
- `recommendedSyncSettings`: Suggested ClickHouse settings for safe execution

**Operation Classifications:**
- `metadata` - Safe DDL changes (CREATE/DROP table)
- `mutation` - ALTER operations triggering ClickHouse mutations
- `data-copy` - Operations requiring data copying
- `forbidden` - Unsafe operations (e.g., modifying key columns)

### SQL Rendering

#### `renderMigrationArtifacts(plan, options)`

Renders migration plan to SQL artifacts.

**Parameters:**
- `plan`: Migration plan or diff result
- `options.name`: Migration name
- `options.timestamp`: Migration timestamp
- `options.cluster?`: Cluster name for ON CLUSTER clauses

**Returns:** `RenderMigrationArtifactsResult` containing:
- `upSql`: Forward migration SQL
- `downSql`: Rollback migration SQL (best-effort)
- `meta`: Migration metadata
- `plan`: The migration plan

#### `writeMigrationArtifacts(options)`

Writes migration artifacts to filesystem.

**Parameters:**
- `options.outDir`: Migrations output directory
- `options.migrationName`: Migration name
- `options.artifacts`: Rendered artifacts

**Returns:** Promise resolving to `WriteMigrationArtifactsResult` with migrationDir path

## CLI Integration

The schema package powers the `hypequery` CLI commands:

```bash
# Generate migration from schema changes
hypequery generate:migration <name>

# Generate custom SQL migration
hypequery generate:migration <name> --custom

# Deploy pending migrations
hypequery migrate:deploy

# Check migration status
hypequery migrate:status

# Verify migration checksums
hypequery migrate:check

# Pull schema from database as baseline
hypequery pull

# Push schema directly to database (dev only)
hypequery push
```

### CLI Flags

**`generate:migration` flags:**
- `--force` - Skip all confirmations (for CI/CD)
- `--skip-cost-analysis` - Skip database statistics queries
- `--custom` - Create custom SQL migration template

## Examples

### Basic Table with Partition

```typescript
const events = defineTable('events', {
  columns: {
    id: column.UInt64(),
    user_id: column.UInt64(),
    event_type: column.LowCardinality('String'),
    timestamp: column.DateTime(),
    data: column.JSON(),
  },
  engine: {
    type: 'MergeTree',
    orderBy: ['timestamp', 'id'],
    partitionBy: sql`toYYYYMM(timestamp)`,
  },
  settings: {
    index_granularity: 8192,
  },
});
```

### Replicated Table with Cluster

```typescript
const users = defineTable('users', {
  columns: {
    id: column.UInt64(),
    email: column.String(),
  },
  engine: {
    type: 'ReplicatedMergeTree',
    orderBy: ['id'],
    replicaPath: sql`'/clickhouse/tables/{shard}/users'`,
    replicaName: sql`'{replica}'`,
  },
});
```

### Materialized View for Aggregations

```typescript
const dailyStats = defineMaterializedView('daily_stats', {
  from: events,
  to: 'daily_stats_table',
  engine: {
    type: 'SummingMergeTree',
    orderBy: ['date', 'event_type'],
  },
  select: sql`
    SELECT
      toDate(timestamp) AS date,
      event_type,
      count() AS event_count,
      uniq(user_id) AS unique_users
    FROM events
    GROUP BY date, event_type
  `,
});
```

## Best Practices

### 1. Use Type-Safe Defaults

```typescript
// ✅ Good - type-safe literal
status: column.String().default('pending')

// ✅ Good - SQL expression
created_at: column.DateTime().default(sql`now()`)

// ❌ Avoid - error-prone string
status: column.String().default(sql`'pending'`)
```

### 2. Leverage LowCardinality

```typescript
// For columns with < 10,000 unique values
status: column.LowCardinality('String')
country_code: column.LowCardinality('FixedString(2)')
```

### 3. Partition Large Tables

```typescript
engine: {
  type: 'MergeTree',
  orderBy: ['timestamp', 'id'],
  partitionBy: sql`toYYYYMM(timestamp)`,  // Monthly partitions
}
```

### 4. Use Nullable Sparingly

```typescript
// Only when truly needed
optional_field: column.String().nullable()

// Prefer defaults for most cases
status: column.String().default('unknown')
```

### 5. Test in Staging First

```bash
# Generate migration
hypequery generate:migration add_feature

# Review generated SQL
cat migrations/20260527_add_feature/up.sql

# Test on staging
CLICKHOUSE_URL=staging hypequery migrate:deploy

# Deploy to production
CLICKHOUSE_URL=production hypequery migrate:deploy
```

## Troubleshooting

### Migration Blocked by Unsupported Change

**Problem:** "Cannot generate automatic migration - PossibleColumnRename detected"

**Solution:** Create a custom migration:
```bash
hypequery generate:migration rename_user_name --custom
# Edit up.sql to add:
ALTER TABLE users RENAME COLUMN old_name TO new_name;
```

### Mutation Taking Too Long

**Problem:** ALTER TABLE mutation runs indefinitely on large table

**Solution:** Use recommended sync settings:
```sql
-- In up.sql, before ALTER statement:
SET mutations_sync = 2;  -- Wait for replicas
SET replication_alter_partitions_sync = 2;
```

### Materialized View Out of Sync

**Problem:** MV data doesn't match source after schema change

**Solution:** Recreate the MV:
```bash
hypequery generate:migration recreate_mv --custom
# In up.sql:
DROP VIEW orders_by_day;
CREATE MATERIALIZED VIEW orders_by_day AS SELECT ...;
```

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## License

Apache 2.0 - see [LICENSE](../../LICENSE) for details.

## Links

- [Documentation](https://hypequery.com/docs)
- [GitHub Repository](https://github.com/hypequery/hypequery)
- [Issue Tracker](https://github.com/hypequery/hypequery/issues)
- [npm Package](https://www.npmjs.com/package/@hypequery/schema)

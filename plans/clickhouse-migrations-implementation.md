# `@hypequery/clickhouse` Migrations

## Phased Full Implementation Plan

## Purpose

This document translates the revised migration spec into an implementation plan that fits the current monorepo:

- migration logic in `packages/clickhouse`
- CLI commands in `packages/cli`
- documentation later in `website-next`

It assumes a narrow v1 centered on correctness, package boundaries, and materialized view sequencing, with later phases expanding coverage.

## Current State

Before this work, the codebase provided:

- ClickHouse query builder and runtime in `packages/clickhouse`
- end-user CLI in `packages/cli`
- schema introspection that generates `IntrospectedSchema`
- no config loader for `hypequery.config.ts`
- no TypeScript-owned DDL AST
- no migration journal, diff engine, or execution layer

This means the migration system must start with new foundations rather than layering on the existing generator.

## Progress So Far

Status as of the first migrations foundation PR:

- Phase 0 is complete.
- Phase 1 is complete for the initial supported schema surface.
- Phase 2 is complete for the initial diff-operation set.
- Phase 3 is complete for v1 planning scope; live ClickHouse querying remains future introspection/execution work.
- Phase 4 is partially complete for reviewable SQL artifact generation, but not yet final because generation is still evolving around the planner model.

Completed implementation:

- `packages/clickhouse/src/migrations/config`
  - `defineConfig`
  - `resolveClickHouseConfig`
  - migration directory defaults
  - typed ClickHouse migration config
- `packages/cli/src/utils/load-hypequery-config.ts`
  - loads `hypequery.config.ts`
  - validates the loaded object is ClickHouse migration config-shaped
- `packages/clickhouse/src/migrations/schema`
  - `defineSchema`
  - `defineTable`
  - `defineMaterializedView`
  - `column.*` builders for the initial type surface
  - structured column defaults that distinguish SQL expressions from literal defaults
- `packages/clickhouse/src/migrations/snapshot`
  - deterministic snapshot serialization
  - stable JSON output
  - content hashing
  - materialized-view dependency edges from managed schema definitions
- `packages/clickhouse/src/migrations/diff`
  - typed operation model
  - create/drop table detection
  - add/drop/modify column detection
  - materialized-view create/drop/recreate detection
  - MV-aware table alteration wrapper operation
  - unsupported possible-rename detection
  - unsupported engine/settings-change detection
- `packages/clickhouse/src/migrations/plan`
  - initial `MigrationPlan` model
  - static operation classification as `metadata`, `mutation`, `data-copy`, or `forbidden`
  - diagnostics
  - blockers from unsupported changes
  - required confirmations for mutation-class operations
  - analyzer plugin hook
  - recommended ClickHouse sync settings for the future executor
  - static key-column forbidden-operation detection
  - provided-context cost estimates for table rows, bytes, active parts, pending mutations, and replica delay
- `packages/clickhouse/src/migrations/sql`
  - MV-aware `up.sql` rendering
  - best-effort `down.sql` rendering
  - cluster clause rendering
  - metadata generation with operation classifications
  - `plan.json` writing
  - safe migration-name validation
  - identifier validation
  - string literal escaping
- public exports from `@hypequery/clickhouse`
  - schema DSL
  - snapshot serializer
  - diff engine
  - planner
  - SQL artifact renderer/writer

Quality and validation completed:

- removed manual `src/index.d.ts` to avoid declaration drift
- exported the generated migration types from `src/index.ts`
- added unit coverage for config, schema DSL, snapshot serialization, diffing, planning, SQL rendering, and artifact writing
- verified:
  - `pnpm --filter @hypequery/clickhouse test`
  - `pnpm --filter @hypequery/cli test`
  - `pnpm --filter @hypequery/clickhouse build`
- external canary smoke test passed against `@hypequery/clickhouse@0.0.0-canary-20260423101304`
  - TypeScript imports compiled in a separate consumer repo
  - schema DSL, snapshots, diffing, SQL rendering, and artifact writing worked
  - MV-safe SQL sequencing generated correctly
  - literal, numeric, and SQL-expression defaults rendered correctly
  - unsupported rename-like changes were detected and rejected at render time
  - invalid migration artifact names were rejected

Known current limitations:

- no CLI migration command yet
- no migration journal/state table yet
- no ClickHouse execution layer yet
- no live schema introspection for migrations yet
- no drift detection yet
- planner consumes provided cost context but does not query `system.*` tables itself
- SQL rendering supports the initial operation set only
- data migrations remain custom SQL only

## Target Architecture

### Future package boundary

Keep the first implementation inside `@hypequery/clickhouse`, but structure modules so a future `@hypequery/migrations-core` extraction remains possible.

The likely future split is:

- generic migration primitives
  - artifact metadata
  - journal/checksum primitives
  - planner diagnostics
  - command-independent migration plan interfaces
- ClickHouse-specific implementation
  - schema DSL
  - snapshot serializer
  - diff engine
  - operation classifier
  - SQL renderer
  - introspection and execution adapters

Do not prematurely genericize ClickHouse concepts such as engines, materialized-view sequencing, operation cost classes, or system-table checks. Those are the product differentiators and should remain ClickHouse-native.

### `packages/clickhouse`

New internal areas:

```text
packages/clickhouse/src/
  migrations/
    config/
    schema/
    snapshot/
    diff/
    sql/
    introspect/
    execute/
    journal/
    checksums/
```

Responsibilities:

- schema DSL and AST
- config types and loader helpers
- serializer and snapshot model
- diff engine
- SQL rendering
- dependency graph for materialized views
- live schema introspection helpers
- migration execution helpers

### `packages/cli`

New command areas:

```text
packages/cli/src/
  commands/
    generate-migration.ts
    migrate.ts
    push.ts
    pull.ts
    status.ts
    check.ts
    drop.ts
  utils/
    load-hypequery-config.ts
```

Responsibilities:

- user-facing commands
- file-system interactions
- prompts and confirmations
- command output and lifecycle UX

## Delivery Strategy

### Guiding rule

Do not begin with migration execution. Start by making the desired state representable and serializable. Every later layer depends on that.

### Another guiding rule

Materialized view sequencing stays in the initial product release even if other coverage is deferred. It is a strategic requirement, not polish.

### Scope guardrail

Do not let generated schema migrations expand into generated data migrations.

v1 should support:

- generated schema migrations
- custom SQL data migrations in the same timeline

v1 should not attempt:

- generated backfills
- generated data rewrites
- automatic rename/data-copy workflows

## Phase 0: Foundations and Contracts

### Goal

Create the internal contracts that every later phase depends on.

### Deliverables

- config types
- config file loading
- migration directory conventions
- core snapshot types
- initial schema AST types

### Implementation details

#### 0.1 Define config contract

Add:

- `defineConfig()` in `packages/clickhouse`
- `HypequeryClickHouseConfig` type
- config loader in CLI using the same TypeScript module-loading pattern already used by `dev`

Key decisions:

- one config file name: `hypequery.config.ts`
- explicit schema entry path required
- explicit migrations output directory required or defaulted deterministically

#### 0.2 Introduce schema AST

Add schema-definition types for:

- tables
- columns
- engine config
- settings
- materialized views
- SQL expression wrappers

This is not yet the fluent query builder. It is a separate DDL-oriented model.

#### 0.3 Define snapshot model

Snapshot types should be JSON-serializable and stable across versions.

Top-level entities:

- `Snapshot`
- `SnapshotTable`
- `SnapshotColumn`
- `SnapshotMaterializedView`
- `SnapshotDependencyEdge`

### Exit criteria

- config file can be loaded from CLI
- a simple schema file can be represented as AST
- AST can be serialized to a stable snapshot object in memory

## Phase 1: Schema DSL and Serialization

### Goal

Make TypeScript the source of truth for schema state.

### Deliverables

- `defineSchema`
- `defineTable`
- `defineMaterializedView`
- `column.*` builders for initial supported types
- snapshot serializer

### Initial supported surface

#### Columns

- integer family
- float family
- `Decimal`
- `String`
- `FixedString`
- `LowCardinality`
- `Nullable`
- `Date`
- `DateTime`
- `DateTime64`
- `UUID`
- `JSON`

#### Engines

- `MergeTree`
- `ReplacingMergeTree`
- `SummingMergeTree`

Restricting the supported engines early reduces serializer and renderer complexity.

### Internal work

#### 1.1 Deterministic normalization

Serializer must normalize:

- column order
- engine parameter representation
- settings ordering
- SQL expression formatting boundaries

#### 1.2 Snapshot hashing

Generate deterministic content hashes for snapshots. This is useful for diff sanity checks and later caching.

### Testing

- AST-to-snapshot unit tests
- normalization tests
- serializer golden tests

### Exit criteria

- schema file can be loaded and serialized to JSON snapshot
- snapshots are stable across repeated runs

## Phase 2: Diff Engine

### Goal

Produce typed operations from snapshot changes.

### Deliverables

- diff engine
- typed migration operation model
- unsupported-change detection

### Operation set for initial release

- `CreateTable`
- `DropTable`
- `AddColumn`
- `DropColumn`
- `ModifyColumnDefault`
- `CreateMaterializedView`
- `DropMaterializedView`
- `RecreateMaterializedView`
- `AlterTableWithDependentViews`
- optional `ModifyColumnType` gated behind warnings

### Key design choice

Do not infer renames in the first version unless there is a high-confidence explicit annotation later. Rename inference causes bad diffs and accidental data loss.

Treat likely renames as:

- unsupported
- or explicit drop/add requiring confirmation

Document the recommended replacement recipe instead:

1. add the replacement column
2. backfill it with a custom SQL migration
3. switch reads and writes
4. drop the old column later

Important nuance:

`RENAME COLUMN` can be metadata-level in modern ClickHouse. The reason v1 should avoid automatic rename inference is not just physical cost; it is semantic safety. Materialized views, application queries, and generated types can still reference the old name.

### Materialized view dependency graph

Build a dependency graph from managed schema objects:

- source table to view edges
- optional view-to-target table metadata

This graph powers sequencing decisions later.

### Testing

- snapshot-to-ops tests
- unmanaged dependency detection tests
- unsupported sort-key change tests
- operation classification tests

### Exit criteria

- snapshot deltas produce stable operation lists
- unsupported operations are rejected deterministically

## Phase 3: Planner and Safety Classification

Status: complete for v1 planning scope.

### Goal

Turn raw diff operations into an explicit migration plan before SQL is rendered.

### Deliverables

- `MigrationPlan` model: initial version implemented
- operation classification: initial static classifier implemented
- diagnostic model: initial version implemented
- initial blocker handling for unsupported changes: implemented
- analyzer plugin surface: implemented
- recommended sync settings: implemented
- static key-column forbidden classification: implemented
- cost estimate model: implemented
- provided ClickHouse context enrichment: implemented
- live ClickHouse querying: intentionally deferred to introspection/execution phases

### Operation classification

Classify each operation as:

- `metadata`
- `mutation`
- `data-copy`
- `forbidden`

Initial implementation can classify from static snapshot/diff information only.

Current static classification:

- `ModifyColumnType` => `mutation`
- `DropColumn` or `ModifyColumnType` on key columns => `forbidden`
- `AlterTableWithDependentViews` => highest nested table-mutation classification
- initial create/drop/add/default/MV operations => `metadata`
- unsupported changes become plan blockers before rendering
- `data-copy` is reserved for future custom/compound operations

The planner can consume provided context shaped from live ClickHouse data. The actual queries are deferred to later phases.

Relevant future data sources:

- `system.parts`
- `system.mutations`
- `system.replicas`
- `system.distributed_ddl_queue`

### Planner output

The plan should include:

- operations: implemented
- classifications: implemented
- diagnostics: implemented
- blockers: implemented
- required confirmations: implemented for mutation-class operations
- recommended sync settings: implemented
- cost estimates: implemented when table stats are provided
- source and target snapshot hashes: implemented
- planned statements or statement placeholders: not implemented yet; SQL renderer still owns concrete SQL statement rendering

### Analyzer direction

The planner supports custom analyzers with:

```ts
(plan, context) => ({
  diagnostics?: Diagnostic[],
  blockers?: Blocker[],
  confirmations?: Confirmation[],
})
```

This lets analyzers warn, hard-block rendering, or require explicit approval without overloading diagnostic severity.

Built-in/static analyzer coverage currently includes:

- destructive drop diagnostics
- mutation diagnostics
- key-column forbidden diagnostics
- cost-threshold diagnostics for provided table stats
  - expensive mutation bytes
  - expensive mutation rows
  - high active part count
  - pending mutations
  - replica delay

Future analyzers:

- materialized-view dependency analyzer
- cluster-safety analyzer
- unmanaged-dependency analyzer

### Testing

- operation classification tests: implemented
- blocker tests: implemented
- diagnostic tests: implemented
- analyzer tests: implemented
- required sync setting tests: implemented
- provided-context cost-estimation tests: implemented
- live query integration tests: deferred

### Exit criteria

- unsupported changes block plan rendering deterministically: implemented
- renderable operations carry classifications: implemented
- forbidden key-column operations block rendering deterministically: implemented
- static planner emits recommended sync settings for executor use: implemented
- planner attaches cost estimates from provided context: implemented
- planner emits cost-threshold diagnostics from provided context: implemented
- SQL generation no longer consumes raw diff output directly: partially implemented

Compatibility note:

`renderMigrationArtifacts()` still accepts a raw `SnapshotDiffResult` for API continuity, but internally converts it to a `MigrationPlan`. New callers should prefer calling `createMigrationPlan()` explicitly and passing the plan to the renderer.

## Phase 4: SQL Generation

### Goal

Render typed operations into ClickHouse SQL with safe ordering.

### Deliverables

- operation-to-SQL renderer
- migration file writer
- best-effort down generator
- operation classifications surfaced in metadata

### Core renderer modules

- table renderer
- column renderer
- engine renderer
- materialized view renderer
- cluster clause renderer

### Materialized view sequencing rules

For any operation touching a managed source table:

1. inspect dependency graph
2. determine affected views
3. emit drop statements for dependent views
4. emit table alteration
5. emit recreated view statements

### Rendering rules

SQL generation consumes a `MigrationPlan`, not raw diff output.

Implementation expectation:

- metadata operations render normally
- mutation operations render with warnings and set `unsafe`
- data-copy operations render only when provided explicitly by custom SQL or future compound primitives
- forbidden operations never reach rendering
- generated DDL should use `IF EXISTS` / `IF NOT EXISTS` where ClickHouse supports it

### Required output metadata

Each migration directory should include:

- `up.sql`
- `down.sql`
- `plan.json`
- `meta.json`

`meta.json` should contain:

- migration name
- timestamp
- operation list
- source snapshot hash
- target snapshot hash
- flags like `custom`, `unsafe`, `contains_manual_steps`
- operation classifications

### Testing

- SQL golden tests
- MV sequencing golden tests
- cluster-clause rendering tests
- unsafe/manual-step metadata tests

### Exit criteria

- generator can write reviewable migration folders from snapshot diffs

## Phase 5: CLI Integration

### Goal

Expose the system through `@hypequery/cli`.

### Commands

#### 5.1 `generate`

Flow:

1. load config
2. load schema
3. serialize snapshot
4. load latest journal snapshot
5. diff
6. plan and classify
7. render SQL
8. write migration folder
9. update journal

For custom migrations:

1. create migration folder
2. write user-authored `up.sql`
3. write stub or optional `down.sql`
4. mark `meta.json.custom = true`
5. do not auto-advance schema snapshot unless later baselined

#### 5.2 `pull`

Flow:

1. connect to ClickHouse
2. introspect current schema
3. emit baseline schema file
4. write `0000_snapshot.json`
5. initialize journal

#### 5.3 `plan`

Write a reviewable `plan.json` and SQL preview without applying anything.

#### 5.4 `drop`

Remove latest unapplied migration and roll back journal metadata only.

### Notes on naming

The existing `generate` command currently means type generation. You have two choices:

- keep `generate` for schema-type generation and introduce `generate:migration`, or
- repurpose `generate` as migration generation and rename today's schema type generation to `pull-types` or similar

This is a product decision, not just an implementation detail. It should be resolved before shipping to avoid CLI churn.

Migration directory naming should stay simple:

- `20260422140000_add_orders_table`
- `20260422140500_backfill_order_region`

Use the shape `<timestamp>_<slug>`.

### Testing

- command unit tests
- fixture-based end-to-end generation tests

### Exit criteria

- users can create migration files and baseline from a live database

## Phase 6: Migration Execution

### Goal

Apply generated migrations and track applied state.

### Deliverables

- migration table bootstrap
- ordered migration application
- checksum recording
- `status` and `check` commands
- per-statement progress tracking
- statement-boundary parsing via `-- hypequery:breakpoint`

### Execution model

#### 6.1 State table management

Create `_hypequery_migrations` on first run if missing.

Use a richer table than a minimal `{name, checksum}` journal because ClickHouse DDL is non-transactional and partial progress matters.

Recommended fields:

- migration id
- monotonic version
- migration name
- checksum
- type
- started/finished/rolled-back timestamps
- applied step count
- total steps
- per-statement hashes
- status
- error statement/message
- execution time
- applied user
- cluster
- hypequery version

For cluster mode, prefer a replicated engine variant.

#### 6.2 Checksum strategy

Checksum should be computed over canonical file contents.

Recommended:

- hash `up.sql`
- hash `down.sql` if present
- hash `meta.json`
- hash `plan.json` if present
- combine hashes into one migration checksum

Also maintain a `hypequery.sum` file in the migration directory tree:

- whole-directory hash
- per-file SHA-256 hashes

`migrate` should verify this before applying.

#### 6.3 Failure behavior

Because ClickHouse DDL is non-transactional:

- stop on first failure
- record failed/dirty state with the failing statement
- print explicit reconciliation guidance
- explicitly warn that partial ClickHouse side effects may already exist

Do not attempt automatic rollback in v1.

#### 6.4 Distributed lock

Use a distributed lock before production apply.

Preferred later implementation:

- KeeperMap-backed lock table
- TTL-based expiry
- owner/process metadata for diagnostics

If this is deferred, `migrate deploy` must say so clearly.

#### 6.5 Post-step verification

Execution should not trust the client acknowledgement alone.

After statements:

- poll `system.mutations` for mutation completion
- poll `system.replicas` for replica queue health where applicable
- poll `system.distributed_ddl_queue` for `ON CLUSTER` convergence
- re-query `system.columns` / `system.tables` before dependent follow-up steps

### Safety messaging

Execution UX should distinguish:

- metadata migrations
- mutation-bearing migrations
- forbidden/rewrite-class migrations that should never be generated in v1

The CLI must not imply transactional rollback safety.

### `status`

Should show:

- applied migrations
- pending migrations
- checksum mismatch warnings

### `check`

Should verify:

- applied migration files still match stored checksums

### Testing

- local execution tests against ClickHouse test container
- partial-failure behavior tests

### Exit criteria

- migrations can be applied, tracked, and verified

## Phase 7: Push Workflow

### Goal

Provide a dev-only fast path.

### Behavior

`push` should:

1. compute diff from current snapshot baseline
2. render SQL
3. apply directly without writing migration files
4. optionally warn that history was not recorded

### Constraints

- explicit dev-only messaging
- not recommended for CI or production

## Phase 8: Introspection and Baseline Adoption

### Goal

Support existing ClickHouse users.

### Deliverables

- live schema introspector richer than today's `SHOW TABLES` + `DESCRIBE TABLE`
- TypeScript schema emitter for managed objects
- baseline snapshot generator

### Required introspection coverage

- tables and columns
- engines
- order keys
- partition keys
- settings
- managed materialized views where discoverable

### System tables to use

Initial implementation should draw from:

- `system.tables`
- `system.columns`
- `system.parts`
- `system.mutations`
- `system.replicas`
- `system.distributed_ddl_queue`

### Hard edge

Introspecting arbitrary materialized view SQL into a clean TypeScript DSL is hard. The first version may need:

- a conservative SQL-string-preserving emitter
- or partial support limited to patterns the DSL can represent

If a live object cannot be cleanly represented, the tool should emit a clear TODO section rather than silently dropping detail.

## Phase 9: Safety and Unsupported-Change UX

### Goal

Prevent users from over-trusting automation.

### Deliverables

- expensive-operation warnings
- unsupported-change errors
- manual migration guidance
- custom migration generation

### Examples

Warn on:

- `MODIFY COLUMN` type rewrites
- `DROP COLUMN`
- `DROP TABLE`

Reject and require custom SQL for:

- sorting key changes
- rebuild-copy-swap flows
- unmanaged dependency chains

## Phase 10: Fuller ClickHouse Coverage

### Goal

Expand beyond the initial safe core after the product is stable.

### Possible additions

- more engine variants
- projections
- skipping indices
- TTL definitions
- replicated/distributed table helpers
- `ON CLUSTER` generation polish
- future reconciliation workflows
- automated shadow-table migrations for rewrite-class changes
- KeeperMap distributed locking
- cost-estimated migration plans
- resumable chunked data migrations
- materialized-view SELECT dependency parsing
- compound primitives such as `exchangeSwap`, `renameColumnSafely`, and `alterMaterializedView`

These are expansion phases, not prerequisites for a useful launch.

## Recommended Milestone Plan

### Milestone A: Foundational alpha

- Phase 0
- Phase 1
- Phase 2

Outcome:

- schema DSL
- config loading
- snapshot serialization
- diff engine in memory

### Milestone B: Migration generation alpha

- Phase 3
- Phase 4
- Phase 5

Outcome:

- reviewable migration plans
- generated migration folders
- baseline pull
- MV-aware SQL generation

### Milestone C: Execution beta

- Phase 6
- Phase 7

Outcome:

- tracked migration application
- status and checksum verification
- dev push workflow

### Milestone D: Adoption and hardening

- Phase 8
- Phase 9

Outcome:

- baseline adoption for real ClickHouse users
- stronger safety UX

### Milestone E: Coverage expansion

- Phase 10

Outcome:

- broader ClickHouse support after core workflows are stable

## Risks

### 1. Schema DSL overreach

If the DSL tries to model all of ClickHouse immediately, phase 1 expands uncontrollably.

Mitigation:

- start with a deliberately incomplete but coherent supported set

### 2. Materialized view recreation semantics

Dropping and recreating views may not preserve all user expectations around downstream data.

Mitigation:

- support only managed views in v1
- document that replay/backfill is outside automatic guarantees

### 3. CLI naming conflict

`generate` already means schema type generation in the current product.

Mitigation:

- resolve naming before implementation lands publicly

### 4. Drift from custom migrations

Raw SQL migrations can desynchronize snapshots.

Mitigation:

- make reconciliation explicit in CLI and docs

### 6. False confidence in ClickHouse failure recovery

Users may assume failed migrations can simply be retried without consequences.

Mitigation:

- document that ClickHouse failures may leave partial state behind
- surface higher-risk mutation classifications clearly
- reject rewrite-class automation in v1

### 7. Planner layer complexity

Adding a planner layer can slow early delivery if it tries to solve live cost estimation immediately.

Mitigation:

- start with static classification and blockers
- defer live system-table cost estimates to execution/planning hardening
- keep the plan JSON stable and reviewable

### 5. False confidence in down migrations

Generated inverse SQL may appear safer than it is.

Mitigation:

- label `down.sql` as best-effort
- omit when inversion is not trustworthy

## Test Strategy

### Unit tests

- schema AST
- serializer normalization
- diff engine
- SQL rendering
- checksum logic

### Golden tests

- migration folder output
- MV sequencing SQL
- journal updates

### Integration tests

- apply migrations against ClickHouse test instance
- baseline from live schema
- status and check commands

### Fixture tests

- representative repo fixtures with `hypequery.config.ts` and schema files

## Suggested Internal API Sketch

### `packages/clickhouse`

```ts
export function defineConfig(config: HypequeryClickHouseConfig): HypequeryClickHouseConfig
export function defineSchema(schema: SchemaDefinition): SchemaDefinition
export function defineTable(name: string, input: TableDefinitionInput): TableDefinition
export function defineMaterializedView(
  name: string,
  input: MaterializedViewDefinitionInput
): MaterializedViewDefinition

export function serializeSchema(schema: SchemaDefinition): Snapshot
export function diffSnapshots(from: Snapshot, to: Snapshot): MigrationOperation[]
export function renderMigration(
  ops: MigrationOperation[],
  context: RenderContext
): RenderedMigration
export async function introspectClickHouseSchema(
  config: DbCredentials
): Promise<Snapshot>
export async function applyMigration(
  migration: RenderedMigration,
  context: ExecutionContext
): Promise<void>
```

### `packages/cli`

```ts
export async function generateMigrationCommand(options: GenerateMigrationOptions): Promise<void>
export async function migrateCommand(options: MigrateOptions): Promise<void>
export async function pushCommand(options: PushOptions): Promise<void>
export async function pullCommand(options: PullOptions): Promise<void>
export async function statusCommand(options: StatusOptions): Promise<void>
export async function checkCommand(options: CheckOptions): Promise<void>
export async function dropCommand(options: DropOptions): Promise<void>
```

## Final Recommendation

Build this as a new platform layer inside hypequery, not as an extension of the current schema-type generator.

The order matters:

1. config
2. schema AST
3. snapshots
4. diffs
5. SQL generation
6. MV sequencing
7. CLI workflows
8. execution and verification

If that order is respected, the feature can launch with a narrow but defensible v1 and expand cleanly afterward.

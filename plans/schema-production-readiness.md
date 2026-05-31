# @hypequery/schema: Production Readiness Plan

**Based on:** Competitive analysis vs. Atlas, golang-migrate, MooseStack, Drizzle + Critical Expert Audit
**Current Status:** Canary - Core features solid, **1 P0 BLOCKER** + trust gaps need closing
**Target:** Drop canary tag, position as "Safe ClickHouse migrations for TypeScript + AI agents"

---

## ⚠️ CRITICAL AUDIT FINDINGS (P0-P6)

**Audit Date:** 2026-05-30
**Methodology:** Expert review against ClickHouse docs, Altinity best practices, dbt-clickhouse, PostHog, Tinybird, BigData Boutique

### P0 - DATA LOSS FOOTGUN 🔴 **SHIP BLOCKER**

**Automatic MV drop/recreate is unsafe and violates expert consensus.**

**Current Behavior:**
- `RecreateMaterializedView` silently does `DROP → CREATE` with no warnings (lines 110-114, 182-208 in `sql/render.ts`)
- `AlterTableWithDependentViews` drops MVs, alters table, recreates MVs automatically
- **No ingestion pause warning**
- **No blind window detection**
- **No backfill recipe generation**

**Why This Is Wrong:**
1. **Data loss during blind window:** Inserts to source table between DROP and CREATE never reach MV target
2. **Violates universal expert guidance:**
   - dbt-clickhouse defaults `mv_on_schema_change: fail` "to prevent data loss"
   - Altinity: "NOT atomic, so stop data ingestion during that procedure"
   - BigData Boutique: "Schema migrations create a data gap — plan and script them before execution"
3. **Kafka-engine footgun:** Dropping Kafka-backed MV is how teams pause ingestion (PostHog). Auto-recreate unexpectedly resumes it.
4. **Implicit .inner. MV destruction:** Dropping implicit-target MVs loses data permanently (the .inner. table is auto-dropped)

**Expert-Aligned Approach:**
1. **Prefer `ALTER TABLE ... MODIFY QUERY`** when the change permits (no target schema change)
2. **When target table schema changes:** Alter target first, then MODIFY QUERY
3. **Only drop/recreate when structurally unavoidable**, AND:
   - Make it an **explicit, blocked operation requiring confirmation**
   - Emit **ingestion-pause / blind-window warning**
   - Auto-generate **backfill recipe** for the gap
   - Detect TO vs. implicit .inner. MVs and **refuse to auto-touch implicit ones**
   - Detect Kafka-engine sources and treat MV drop as ingestion-control action

**Files to Fix:**
```
packages/schema/src/diff/diff.ts:114-136 (diffChangedMaterializedViews)
packages/schema/src/sql/render.ts:110-114, 165-172, 182-208
packages/schema/src/diff/types.ts (add ModifyMaterializedViewQuery operation)
```

**References:**
- dbt-clickhouse: https://github.com/silentsokolov/dbt-clickhouse
- Altinity: https://altinity.com/blog/clickhouse-materialized-views
- PostHog: https://posthog.com/handbook/engineering/clickhouse

---

### P1 - WRONG DIFF AUTHORITY 🟡

**Snapshot-to-snapshot diff is weaker than code↔live-DB diff for OLAP.**

**Current Behavior:**
- Diffs `previousSnapshot` (stored file) vs. `nextSnapshot` (current code)
- Trusts snapshot history over live DB reality
- Drift detection planned as separate feature (Phase 1.1)

**Why This Is Suboptimal for ClickHouse:**
- OLAP DBs change out-of-band frequently (manual ALTERs, ops interventions, refreshable MVs, other tools)
- When stored snapshot disagrees with reality, snapshot-diff generates **wrong migration**
- Wrong migrations cannot be transactionally rolled back in ClickHouse
- MooseStack explicitly rejects snapshot-diff for this reason

**Expert-Aligned Approach:**
- Make **live DB the authoritative diff source**, not just a drift-detection add-on
- Before apply: diff desired state (code) against **introspected live schema**
- Abort on drift (snapshot-hash mismatch, MooseStack-style)
- Snapshot becomes verification/history, not diff input

**Recommendation:**
Keep snapshot diff as convenience, but **flip the framing**: drift detection should be the core diff source, not an optional check.

---

### P2 - COST CLASSIFIER FRAMING 🟡

**Operation-type should drive cost, not raw table size.**

**Current Moat (Validated as Unique):**
Reading `system.parts`, `system.mutations`, replica delay for cost estimation is **genuinely novel**.
- Atlas linting is PostgreSQL/MySQL-focused, "does not understand ClickHouse cost"
- MooseStack gates on destructive vs. not, not size
- Bytebase has static size threshold (not ClickHouse-aware)
- Tinybird mentions "duration ≈ bytes / speed" in blog, not as tool feature

**✅ Moat is real. But current framing is backwards.**

**Current Framing:**
"Warns when an operation will trigger an expensive mutation on a large table"
→ Over-indexes on size. A 10 TB table with ADD COLUMN is trivial. A 50 GB table with MODIFY COLUMN type is a full rewrite.

**Expert-Aligned Framing:**
**Operation-type → multiplier(active parts, bytes, partitions touched, pending-mutation backlog, replica delay)**

**Refinements Needed:**

1. **CODEC and TTL are conditional, not flat:**
   - Changing CODEC is metadata-only, applies to new parts
   - Old parts get new codec only on merge/OPTIMIZE
   - MODIFY TTL cost depends on `materialize_ttl_after_modify` (default 1 = materialize)
   - Encode conditional costs and relevant session settings

2. **Lightweight delete sub-class:**
   - ClickHouse "≤ 10% of rows" guidance for lightweight ops
   - ~40 bytes/row overhead, ~15% patch-on-read overhead
   - Add lightweight sub-class while keeping heavy-by-default stance

3. **Surface pending mutation backlog and replica delay prominently:**
   - These catch merge-dependency and replication-lag failures that size can't
   - Most defensible part of the moat

**Files to Refine:**
```
packages/schema/src/plan/plan.ts:591 (MigrationOperationCostEstimate)
packages/schema/src/plan/plan.ts (operation classification logic)
```

---

### P3 - MISSING FIRST-CLASS BLUE-GREEN 🟡

**Table swap / EXCHANGE TABLES is the expert-standard cut-over primitive.**

**Current State:**
- ORDER BY/PK/engine changes classified as "forbidden"
- Implies manual recreation, but no first-class workflow

**Expert-Aligned Approach:**
`EXCHANGE TABLES` (Atomic-engine atomic swap) is the only sane path for forbidden changes.

**Make defineSwap / blue-green workflow first-class:**
1. Build shadow table with new schema
2. Backfill data (INSERT...SELECT or ATTACH PARTITION)
3. EXCHANGE TABLES (atomic swap)
4. Drop old table

**ON CLUSTER Awareness:**
- EXCHANGE works on Atomic database, not all engines
- Must coordinate across cluster

**Warnings to Add:**
1. **EXCHANGE-not-fully-atomic SELECT race** (ClickHouse issue #67646)
2. **ReplicatedMergeTree ZooKeeper path reuse footgun:**
   - PostHog: "never re-use Zookeeper paths when re-creating replicated table"
   - Old replicas can resurrect dropped tables if same path used

**Files to Create:**
```
packages/schema/src/operations/blue-green.ts
packages/cli/src/commands/migration-swap.ts
```

---

### P4 - NO REFRESHABLE MVs 🟡

**Refreshable Materialized Views (production-ready in ClickHouse 24.10) not supported.**

**What They Are:**
- Engine-managed refresh (automatic or manual trigger)
- Atomic target swap
- APPEND/REPLACE modes
- Managed by DDL (like SQLMesh's "managed model" proposal)
- Clean alternative to fragile incremental-MV migrations

**Why They Matter:**
- Solves the data-gap problem for full-recompute cases
- No blind window (atomic swap)
- Explicit refresh semantics

**Files to Add:**
```
packages/schema/src/schema/define.ts (defineRefreshableMaterializedView)
packages/schema/src/snapshot/types.ts (SnapshotRefreshableMV)
packages/schema/src/diff/diff.ts (refresh-specific diff logic)
```

**References:**
- ClickHouse 24.10 release notes
- SQLMesh managed models proposal

---

### P5 - NO ORDER BY APPEND EXCEPTION 🟢

**Blanket-forbidding all ORDER BY changes is too conservative.**

**Current Classification:** All ORDER BY changes → forbidden

**ClickHouse Reality:**
- **Cannot** add existing columns, reorder, remove
- **CAN** append brand-new column to end (metadata-only, if no default / default is computable)
- **Cannot** update PK/partition-key columns

**Refinement:**
Permit narrow case: appending new column to end of ORDER BY in same ALTER.

**Files to Fix:**
```
packages/schema/src/plan/plan.ts (ORDER BY classification logic)
```

---

### P6 - ALWAYS SHOW SQL + DRY-RUN 🟢

**Every authority converges on "review the generated plan."**

**Current State:**
- SQL is generated and applied
- User can inspect migration files after `generate:migration`

**Expert-Aligned Approach:**
- **Plan output:** Show all SQL before apply
- **Mandatory dry-run:** Simulate against throwaway DB (or at least show operations)
- **Explicit confirmation:** For any non-metadata op, require confirmation

**AI Agent Safety Story:**
This is the spine of "safe for AI agents" framing:
- Deterministic guardrails (cost classifier)
- Always-visible SQL
- Confirmation for destructive ops

**Files to Modify:**
```
packages/cli/src/commands/migration-deploy.ts (add --dry-run, --yes flags)
packages/cli/src/commands/generate-migration.ts (show SQL preview)
```

---

## Executive Summary (Updated)

**What We Have:** The only ClickHouse migration tool combining TypeScript-native declarative schema, snapshot diffing, AND mutation-cost analysis. Core architecture is production-ready.

**P0 BLOCKER:** Automatic MV drop/recreate is a data-loss footgun. Must fix before launch.

**What's Missing (Trust Gaps):**
1. ✅ Mutation-cost moat is real and unique, but framing needs to be operation-type-first
2. 🔴 P0: Unsafe automatic MV drop/recreate
3. 🟡 P1: Wrong diff authority (snapshot vs. live DB)
4. 🟡 P3: No first-class blue-green / table swap
5. Trust features: drift detection, TTL/CODEC/projections, down-migration clarity

**Competitive Moat (Validated):** Mutation-cost classifier reading live table stats. No competitor has this. Just needs reframing (operation-type → stats multiplier).

**Recommendation:** Fix P0 immediately (1 week), then P1-P3 (1-2 weeks), then launch with cost-analysis moat front-and-center as AI agent safety feature.

---

## Current State Assessment

### ✅ What's Production-Ready (Core Strengths)

1. **TypeScript-Native Schema DSL**
   - `defineSchema()`, `defineTable()`, `defineMaterializedView()`
   - Column builders with type safety
   - Comparable to Drizzle Kit (but Drizzle doesn't support ClickHouse)

2. **Snapshot-Based Diffing Architecture**
   - SHA-256 content hashing
   - Deterministic serialization
   - Proven architecture (same as Drizzle, Prisma)
   - ⚠️ **But P1 issue:** Should use live DB as diff source for OLAP

3. **Mutation-Cost Analysis** ⭐ UNIQUE MOAT (VALIDATED)
   - Analyzes row counts, GB, active parts, pending mutations, replica delay
   - Warns before expensive mutations
   - Classifications: metadata/mutation/data-copy/forbidden
   - **No competitor reads live table stats** (validated against Atlas, MooseStack, Bytebase, Tinybird)
   - ⚠️ **But P2 framing issue:** Should be operation-type → stats multiplier, not size-first

4. **Checksum Verification**
   - MD5 checksums stored in migration table
   - Prevents tampered migration re-runs
   - Statement-level hashing for partial recovery

5. **Semantic Layer Integration** ⭐ ECOSYSTEM LOCK-IN
   - `checkDatasetsAgainstSchema()` validates dataset compatibility
   - Unique to hypequery ecosystem

6. **Basic ON CLUSTER Support**
   - Adds `ON CLUSTER` to DDL
   - Works for simple cluster setups

7. **Forward-Only Philosophy** ⭐ EXPERT-ALIGNED
   - Auto-generates downs only for genuinely reversible ops (CREATE↔DROP)
   - Manual expand-migrate-contract recipes for destructive ops
   - Matches MooseStack and parallel-change literature
   - ⚠️ One gap: Should warn that DROP's inverse doesn't restore data

### ⚠️ What's Partially Implemented

1. **Down Migrations**
   - Auto-generates for safe operations (DROP→CREATE, ADD→DROP)
   - Manual steps required for destructive ops (DROP TABLE, DROP COLUMN, TYPE changes)
   - Marked as `unsafe` but not well-documented

2. **Column Type Coverage**
   - Basic types: Int/UInt/Float/Decimal/String/DateTime ✓
   - Missing builders for: Array, Map, Tuple, Nested, Enum
   - Workaround: `column.Raw()` escape hatch

3. **Engine Support**
   - MergeTree, ReplacingMergeTree ✓
   - Generic engine string ✓
   - Missing: Replicated* specifics, Collapsing/Summing/Aggregating variants

4. **Migration Locking**
   - Implementation exists (migration-locking.ts in git status)
   - Not documented or battle-tested

### ❌ Critical Gaps (Trust Blockers)

1. **🔴 P0: UNSAFE AUTOMATIC MV DROP/RECREATE** ← **SHIP BLOCKER**
   - Silently creates data-loss window between DROP and CREATE
   - Violates universal expert consensus (dbt-clickhouse, Altinity, BigData Boutique)
   - No ingestion pause warning
   - No backfill recipe generation
   - Kafka-engine footgun (auto-recreate resumes paused ingestion)
   - Implicit .inner. MV destruction (data loss)
   - **Must fix before any production usage**

2. **🟡 P1: Snapshot-Diff Authority Wrong for OLAP**
   - Diffs stored snapshot vs. code, not live DB vs. code
   - OLAP DBs change out-of-band frequently (manual ALTERs, ops, other tools)
   - Wrong diff → wrong migration → unrecoverable failure
   - MooseStack explicitly rejects this for OLAP

3. **No Drift Detection** (related to P1)
   - Cannot detect out-of-band schema changes
   - MooseStack's killer feature - we lack it
   - Schema introspection exists but not integrated into diff

4. **No Shadow/Dev-DB Verification** (related to P6)
   - No dry-run against throwaway ClickHouse
   - Prisma/Atlas both do this
   - Critical for ClickHouse where mutations are irreversible

5. **Incomplete ClickHouse Feature Coverage**
   - No TTL column declarations
   - No CODEC specifications
   - No projection definitions
   - No skip index definitions
   - No refreshable MVs (ClickHouse 24.10+)
   - These are everyday ClickHouse features

6. **🟡 P3: No First-Class Blue-Green / Table Swap**
   - ORDER BY/PK/engine changes classified as "forbidden"
   - No `EXCHANGE TABLES` workflow
   - No shadow-table build + atomic swap
   - ReplicatedMergeTree ZooKeeper path reuse footgun

7. **No Interactive Rename Detection**
   - Drizzle prompts: "Is column X renamed from Y?"
   - We require `--custom` flag
   - Poor DX

8. **Limited ReplicatedMergeTree Support**
   - No ZooKeeper path handling
   - No replica coordination settings
   - No partial-replica-failure semantics

---

## Competitive Positioning

### vs. golang-migrate (18,538 ⭐ - The Baseline)

**Their Advantage:** Ubiquitous, battle-tested, language-agnostic
**Our Advantage:**
- TypeScript-native (no hand-written ALTERs)
- Automatic diffing
- Cost-analysis warnings
- MV dependency management

**Win Condition:** "Stop hand-writing ALTERs and stop guessing which one rewrites a terabyte"

### vs. Atlas (8.2k ⭐ - Declarative Rival)

**Their Advantage:**
- More mature, company-backed (Ariga)
- Multi-database support
- 50+ built-in analyzers

**Our Advantage:**
- TypeScript-native (Atlas is HCL/Go)
- Free/Apache-2.0 (Atlas ClickHouse support is Pro-only)
- Mutation-cost analysis (Atlas doesn't read table stats)
- Semantic layer integration

**Win Condition:** "TS-native, free, cost-aware - what Atlas should have been for ClickHouse"

### vs. MooseStack (550-580 ⭐ - TS+ClickHouse Framework)

**Their Advantage:**
- Full framework (streaming, APIs, hosting)
- Drift detection (code vs. live DB)
- Managed hosting option

**Our Advantage:**
- Focused tool (no framework lock-in)
- Cost classifier (Moose only has destructive/safe binary)
- Apache-2.0 vs. proprietary

**Win Condition:** "Just migrations, not a platform - with deeper safety analysis"

### vs. Drizzle Kit (DX Bar)

**Their Advantage:**
- Best-in-class TypeScript DX
- Interactive prompts
- Studio UI
- Huge community

**Our Advantage:**
- ClickHouse support (Drizzle explicitly doesn't)

**Win Condition:** "Drizzle DX for ClickHouse"

---

## Three-Phase Production Plan (REORDERED BY P0-P6)

### Phase 1: MUST-HAVES (Ship Blocker) - 2-3 weeks

**Goal:** Fix P0 data-loss footgun, then close trust gaps that prevent enterprise adoption

**Sequencing:** P0 must complete before any other work. P1-P6 can partially parallelize.

---

#### 1.0 🔴 P0: FIX UNSAFE MV DROP/RECREATE [1 week] ← **START HERE**

**Why:** Data-loss footgun. Violates expert consensus. Blocks any production usage.

**Current files with unsafe behavior:**
- `packages/schema/src/diff/diff.ts:114-136` (diffChangedMaterializedViews)
- `packages/schema/src/sql/render.ts:110-114, 165-172, 182-208` (automatic DROP→CREATE)

**Implementation Plan:**

**Step 1:** Add `ALTER TABLE ... MODIFY QUERY` support (preferred path)
```typescript
// New operation type
interface ModifyMaterializedViewQueryOperation {
  kind: 'ModifyMaterializedViewQuery';
  viewName: string;
  previousQuery: string;
  nextQuery: string;
}
```

**Step 2:** Detect when MODIFY QUERY is safe vs. drop/recreate required
- Safe: SELECT query change, FROM table unchanged, target schema unchanged
- Unsafe: Target table schema changed, TO table changed, implicit .inner. target

**Step 3:** For unsafe cases, block and warn
```typescript
// Migration generation should emit:
warnings.push({
  kind: 'MaterializedViewRequiresManualRecreate',
  viewName: 'daily_summary_mv',
  message: `
⚠️  MATERIALIZED VIEW RECREATION REQUIRED: ${viewName}

This change requires dropping and recreating the materialized view,
which creates a data-loss window where inserts are not captured.

BEFORE APPLYING:
1. Pause ingestion to source table (if Kafka-backed, stop consumers)
2. Note current source table max timestamp for backfill
3. Apply migration (DROP → CREATE)
4. Backfill missing data with INSERT...SELECT for gap period
5. Resume ingestion

Auto-generated backfill recipe:
  INSERT INTO ${targetTable}
  SELECT ${columns}
  FROM ${sourceTable}
  WHERE timestamp > (last_successful_timestamp)
    AND timestamp <= now()

TO SKIP THIS: Use ALTER TABLE...MODIFY QUERY if only SELECT changed
  `,
  requiresConfirmation: true,
});
```

**Step 4:** Detect implicit vs. explicit target MVs
```typescript
// In diffChangedMaterializedViews:
const hasExplicitTarget = view.to !== undefined;
if (!hasExplicitTarget) {
  warnings.push({
    kind: 'ImplicitTargetMaterializedView',
    message: `${viewName} uses implicit .inner. target. ` +
             `Dropping this view will PERMANENTLY DELETE DATA. ` +
             `Convert to explicit TO table first.`
  });
  unsupportedChanges.push({
    kind: 'ImplicitMaterializedViewRecreate',
    message: 'Implicit MV recreation is forbidden (data loss)',
  });
}
```

**Step 5:** Detect Kafka-engine source tables
```typescript
// In diffChangedMaterializedViews:
const sourceTable = snapshot.tables.find(t => t.name === view.from);
if (sourceTable?.engine.type === 'Kafka') {
  warnings.push({
    kind: 'KafkaBackedMaterializedView',
    message: `${viewName} reads from Kafka table ${view.from}. ` +
             `Dropping this MV will pause Kafka ingestion. ` +
             `Recreating will resume ingestion. Ensure this is intentional.`
  });
}
```

**Files to Modify:**
```
packages/schema/src/diff/types.ts              # Add ModifyMaterializedViewQuery
packages/schema/src/diff/diff.ts:114-136       # Replace auto-recreate with MODIFY QUERY + warnings
packages/schema/src/sql/render.ts:110-114      # Add MODIFY QUERY rendering
packages/schema/src/sql/render.ts:165-172      # Update down migration logic
packages/schema/src/sql/render.ts:182-208      # Add backfill recipe generation
```

**Files to Create:**
```
packages/schema/src/mv/detect-mv-safety.ts     # MV change safety detection
packages/schema/src/mv/backfill-recipe.ts      # Generate backfill SQL
```

**Acceptance Criteria:**
- ✅ MODIFY QUERY used when only SELECT changes (no data gap)
- ✅ Drop/recreate blocked with ingestion pause warning
- ✅ Backfill recipe auto-generated
- ✅ Implicit .inner. MV recreation forbidden
- ✅ Kafka-engine source detection with warning
- ✅ Tests cover all MV change scenarios
- ✅ Docs explain the data-loss risk and mitigation

**References:**
- dbt-clickhouse MV handling: https://github.com/silentsokolov/dbt-clickhouse
- Altinity MV best practices: https://altinity.com/blog/clickhouse-materialized-views
- ClickHouse MODIFY QUERY docs: https://clickhouse.com/docs/en/sql-reference/statements/alter/view

---

#### 1.1 🟡 P1: Make Live DB the Diff Authority [3 days]

**Why:** Snapshot-diff generates wrong migrations when DB drifts. OLAP DBs drift frequently.

**Current Behavior:**
- `diffSnapshots(previousSnapshot, nextSnapshot)` diffs stored files only
- Trusts snapshot history over live DB reality

**New Behavior (MooseStack-aligned):**
- Before `generate:migration`: Introspect live DB, compare to code snapshot
- Before `migrate:deploy`: Introspect live DB, abort if drift detected (snapshot hash mismatch)
- Make live DB the authoritative diff source, not just a drift-detection add-on

**Implementation:**

**Step 1:** Add live DB introspection to diff workflow
```typescript
// In generate:migration command
const liveSchema = await introspectClickHouse(client);
const liveSnapshot = schemaToSnapshot(liveSchema);

// Verify last migration was actually applied
const expectedHash = getLastMigrationSnapshotHash();
if (liveSnapshot.contentHash !== expectedHash) {
  throw new Error(`
    DRIFT DETECTED: Live database does not match migration history.

    Expected snapshot hash: ${expectedHash}
    Actual snapshot hash:   ${liveSnapshot.contentHash}

    This means the database was modified outside of migrations.

    Options:
    1. npx hypequery pull --force  # Adopt current DB state as baseline
    2. Manual fix then re-run migrations
    3. npx hypequery migrate:drift # See detailed diff
  `);
}

// Now diff desired state (code) vs live DB (source of truth)
const diff = diffSnapshots(liveSnapshot, desiredSnapshot);
```

**Step 2:** Add drift detection command
```bash
npx hypequery migrate:drift
```

Reports:
- Tables in DB not in schema
- Columns in DB not in schema
- Type mismatches
- Columns in schema not in DB
- Remediation suggestions

**Files to Modify:**
```
packages/cli/src/commands/generate-migration.ts  # Add live DB check before diff
packages/cli/src/commands/migration-deploy.ts    # Add drift abort
packages/schema/src/diff/diff.ts                 # Accept live snapshot as input
```

**Files to Create:**
```
packages/cli/src/commands/migration-drift.ts     # New drift report command
packages/schema/src/introspect/compare.ts        # Diff live vs. code
packages/schema/src/introspect/schema-to-snapshot.ts  # Convert introspected schema to snapshot
```

**Acceptance Criteria:**
- ✅ `generate:migration` aborts if live DB drifted from last migration
- ✅ `migrate:deploy` aborts if drift detected
- ✅ `migrate:drift` shows detailed comparison
- ✅ Drift from manual ALTERs detected
- ✅ Drift from ClickPipes/other tools detected
- ✅ Clear remediation guidance

**Reference:** MooseStack code↔live-DB diff philosophy

---

#### 1.2 🟡 P2: Reframe Cost Classifier (Operation-Type First) [2 days]

**Why:** Moat is real but framing is backwards. Operation-type determines cost, not raw size.

**Current Implementation:**
- Reads `system.parts`, `system.mutations` for table stats ✅
- Classifies operations: metadata/mutation/data-copy/forbidden ✅
- But presents size-first: "warns when mutation on large table"

**New Framing:**
**Operation-type → multiplier(active parts, bytes, partitions touched, pending-mutation backlog, replica delay)**

**Refinements:**

**A. Add CODEC/TTL Conditional Cost**
```typescript
interface CodecChangeClassification {
  kind: 'metadata'; // Applies to new parts only
  futureImpact: 'rewrite-on-merge' | 'rewrite-on-optimize';
  affectedSetting?: 'optimize_on_insert';
  message: string;
}

interface TTLChangeClassification {
  kind: 'metadata' | 'mutation'; // Depends on materialize_ttl_after_modify
  conditionalOn: {
    setting: 'materialize_ttl_after_modify';
    value: 0 | 1; // 0 = metadata, 1 = mutation
  };
  message: string;
}
```

**B. Add Lightweight Delete Sub-Class**
```typescript
interface LightweightMutationClassification {
  kind: 'mutation-lightweight';
  estimatedAffectedRows: number;
  totalRows: number;
  percentage: number; // Should be ≤ 10%
  overheadPerRow: 40; // bytes
  readOverhead: 0.15; // 15% patch-on-read
  warning: string; // If > 10%, recommend DELETE instead
}
```

**C. Surface Pending Mutations and Replica Delay**
```typescript
interface MutationCostEstimate {
  operation: 'AddColumn' | 'ModifyColumnType' | ...;
  baseClassification: 'metadata' | 'mutation' | 'data-copy';
  tableSizeGB: number;
  activeParts: number;
  pendingMutations: number; // ← Most defensible moat signal
  replicaDelaySeconds?: number; // ← Catches replication lag
  estimatedDurationMinutes?: number; // operation-specific formula
}
```

**Cost Formulas (Operation-Specific):**
```typescript
function estimateModifyColumnTypeCost(table: TableStats): CostEstimate {
  // Full rewrite: every part must be rewritten
  const bytesPerSecond = 1_000_000_000; // 1 GB/s disk (conservative)
  const duration = table.bytes / bytesPerSecond;

  return {
    classification: 'mutation',
    estimatedDurationMinutes: duration / 60,
    message: `Full table rewrite required (${table.bytes} bytes across ${table.activeParts} parts)`,
    bottleneck: table.pendingMutations > 5 ? 'mutation-queue-backlog' : 'disk-io',
  };
}

function estimateAddColumnCost(table: TableStats): CostEstimate {
  // Metadata-only: instant
  return {
    classification: 'metadata',
    estimatedDurationMinutes: 0,
    message: `Instant metadata change (new parts will include column)`,
  };
}
```

**Files to Modify:**
```
packages/schema/src/plan/plan.ts:591            # Extend MigrationOperationCostEstimate
packages/schema/src/plan/classify.ts            # Add operation-specific cost formulas
packages/schema/src/plan/stats.ts               # Add pending mutation / replica delay queries
```

**Acceptance Criteria:**
- ✅ Operation-type drives classification, not size
- ✅ CODEC/TTL conditional costs documented
- ✅ Lightweight delete sub-class with 10% threshold
- ✅ Pending mutation backlog surfaced in warnings
- ✅ Replica delay surfaced in warnings
- ✅ Cost estimates are operation-specific

**Positioning:**
"Understands ClickHouse mutation cost at operation level - no competitor does this"

---

#### 1.3 Advanced ClickHouse Features (TTL/CODEC/Projections) [4 days]
**Why:** TTL and CODEC are everyday features. Gaps force users to Raw() escape hatch.

**Implementation:**

**A. TTL Support (ties to P2 conditional cost)**
```typescript
// Column TTL
defineTable({
  columns: {
    created_at: column.DateTime().ttl('created_at + INTERVAL 90 DAY'),
    data: column.String(),
  }
})

// Table TTL
defineTable({
  engine: { type: 'MergeTree', ... },
  ttl: 'created_at + INTERVAL 1 YEAR'
})
```

**B. CODEC Support**
```typescript
column.String().codec('ZSTD(1)')
column.Float64().codec('Delta, LZ4')
```

**C. Projections**
```typescript
defineTable({
  projections: {
    by_user: {
      select: 'user_id, count()',
      orderBy: ['user_id']
    }
  }
})
```

**D. Skip Indexes**
```typescript
defineTable({
  skipIndexes: {
    user_idx: {
      expression: 'user_id',
      type: 'bloom_filter',
      granularity: 4
    }
  }
})
```

**Files:**
```
packages/schema/src/schema/column.ts          # Add TTL, CODEC
packages/schema/src/schema/define.ts          # Add projections, skipIndexes
packages/schema/src/snapshot/serialize.ts     # Serialize new features
packages/schema/src/diff/diff.ts              # Diff logic
packages/schema/src/sql/render.ts             # SQL rendering
```

**E. Refreshable Materialized Views (P4)** - ClickHouse 24.10+
```typescript
defineRefreshableMaterializedView('daily_summary', {
  to: 'daily_summary_table',
  select: `
    SELECT
      toStartOfDay(created_at) as day,
      count() as total_orders,
      sum(amount) as total_revenue
    FROM orders
    GROUP BY day
  `,
  refresh: {
    mode: 'EVERY', // or 'AFTER'
    interval: '1 HOUR',
    settings: { max_execution_time: 300 }
  }
});
```

**Files:**
```
packages/schema/src/schema/column.ts          # Add TTL, CODEC
packages/schema/src/schema/define.ts          # Add projections, skipIndexes, refreshable MVs
packages/schema/src/snapshot/serialize.ts     # Serialize new features
packages/schema/src/diff/diff.ts              # Diff logic
packages/schema/src/sql/render.ts             # SQL rendering
```

**Acceptance:**
- Can define TTL, CODEC, projections, skip indexes, refreshable MVs
- Migrations detect changes
- SQL renders correctly
- Tests cover edge cases

**References:**
- ClickHouse 24.10 refreshable MV docs
- SQLMesh managed models proposal

---

#### 1.4 🟡 P3: First-Class Blue-Green / Table Swap [2 days]

**Why:** `EXCHANGE TABLES` is the expert-standard cut-over for ORDER BY/PK/engine changes.

**Current State:**
- ORDER BY/PK/engine changes → "forbidden" unsupported change
- User must manually create shadow table, backfill, swap, drop

**New Behavior:**
Make blue-green workflow first-class with guided multi-step migration.

**Implementation:**

**Step 1:** Detect forbidden changes and suggest blue-green
```typescript
// In plan.ts when ORDER BY/PK change detected:
unsupportedChanges.push({
  kind: 'OrderByChanged',
  tableName: 'orders',
  message: `
    ⚠️  ORDER BY CHANGE DETECTED: Cannot modify sorting key in-place

    This change requires a blue-green table swap:
    1. Create shadow table with new schema
    2. Backfill data (INSERT...SELECT or ATTACH PARTITION)
    3. EXCHANGE TABLES (atomic swap)
    4. Drop old table

    Run: npx hypequery generate:migration add_orders_swap --blue-green
  `,
  suggestedWorkflow: 'blue-green',
});
```

**Step 2:** Add `--blue-green` flag to migration generation
```typescript
// Generates multi-step migration with manual confirmation points:
// migrations/20260530_orders_blue_green_swap/
//   ├── 1_up_create_shadow.sql      # CREATE TABLE orders_new ...
//   ├── 2_backfill.sql              # INSERT INTO orders_new SELECT * FROM orders
//   ├── 3_up_exchange.sql           # EXCHANGE TABLES orders AND orders_new
//   ├── 4_up_drop_old.sql           # DROP TABLE orders_new (was old orders)
//   └── README.md                   # Warnings and rollback procedure
```

**Step 3:** Add warnings for EXCHANGE gotchas
```markdown
## ⚠️  EXCHANGE TABLES Warnings

1. **Not fully atomic for SELECT:** ClickHouse issue #67646
   - SELECTs during EXCHANGE may return inconsistent results
   - EXCHANGE only locks metadata, not data reads

2. **ReplicatedMergeTree ZooKeeper path reuse footgun:**
   - Never re-use ZooKeeper paths when re-creating replicated table
   - Old replicas can resurrect dropped tables if same path used
   - Always use unique paths: `/clickhouse/tables/{cluster}/{shard}/orders_v2`

3. **Atomic database required:**
   - EXCHANGE TABLES only works on Atomic database engine
   - Check: SELECT engine FROM system.databases WHERE name = 'default'
```

**Files to Create:**
```
packages/schema/src/operations/blue-green.ts           # Blue-green workflow detection
packages/cli/src/commands/generate-migration-swap.ts   # --blue-green flag handler
packages/schema/src/sql/render-blue-green.ts           # Multi-step SQL generation
```

**Files to Modify:**
```
packages/schema/src/plan/plan.ts                       # Add blue-green suggestion to forbidden ops
```

**Acceptance Criteria:**
- ✅ ORDER BY/PK/engine changes suggest blue-green
- ✅ `--blue-green` flag generates multi-step migration
- ✅ EXCHANGE warnings documented
- ✅ ZooKeeper path reuse detection for Replicated* tables
- ✅ Atomic database requirement checked

**References:**
- PostHog: "never re-use Zookeeper paths"
- ClickHouse issue #67646 (EXCHANGE not fully atomic)

---

#### 1.5 🟢 P5: ORDER BY Append Exception [1 day]

**Why:** Blanket-forbidding all ORDER BY changes is too conservative.

**Current Classification:** All ORDER BY changes → forbidden

**ClickHouse Reality:**
- **Cannot** add existing columns, reorder, remove
- **CAN** append brand-new column to end (metadata-only, if column has computable default)
- **Cannot** update PK/partition-key columns

**Implementation:**
```typescript
// In plan.ts operation classification:
function classifyOrderByChange(previous, next): Classification {
  const isAppendOnly =
    previous.length < next.length &&
    previous.every((col, i) => col === next[i]) &&
    allNewColumnsHaveDefaults(next.slice(previous.length));

  if (isAppendOnly) {
    return {
      kind: 'metadata',
      message: 'Appending column to ORDER BY (metadata-only)',
    };
  }

  return {
    kind: 'forbidden',
    message: 'ORDER BY cannot be modified (create new table + EXCHANGE)',
  };
}
```

**Files to Modify:**
```
packages/schema/src/plan/plan.ts     # Refine ORDER BY classification
```

**Acceptance Criteria:**
- ✅ Append-only ORDER BY changes classified as metadata
- ✅ All other ORDER BY changes remain forbidden
- ✅ Tests cover append-only case

**Reference:** ClickHouse ALTER TABLE docs

---

#### 1.6 🟢 P6: Always Show SQL + Dry-Run [1 day]

**Why:** "Review the generated plan" is universal expert consensus. Spine of AI agent safety story.

**Current Behavior:**
- Migrations generated to files
- User can inspect before running
- No mandatory preview step

**New Behavior:**
- **Always show SQL** during generation and before apply
- **Mandatory dry-run** or explicit confirmation for non-metadata ops
- **AI agent safety framing**

**Implementation:**

**Step 1:** Show SQL preview during generation
```bash
$ npx hypequery generate:migration add_user_column

Generated migration: 20260530140000_add_user_column

📋 MIGRATION PLAN:
  ✓ AddColumn: orders.user_id (Int64)          [metadata, instant]

📄 SQL:
  ALTER TABLE orders
  ADD COLUMN user_id Int64

⚠️  Review SQL before applying. Run:
  npx hypequery migrate:deploy --dry-run   # Preview execution
  npx hypequery migrate:deploy             # Apply migration
```

**Step 2:** Add `--dry-run` to migrate:deploy
```bash
$ npx hypequery migrate:deploy --dry-run

🔍 DRY RUN: The following SQL would be executed:

Migration: 20260530140000_add_user_column
  ALTER TABLE orders ADD COLUMN user_id Int64
  Estimated duration: instant (metadata-only)

Migration: 20260530141500_modify_amount_type
  ALTER TABLE orders MODIFY COLUMN amount Decimal(18,4)
  ⚠️  MUTATION: Full table rewrite (125 GB, 450 active parts)
  Estimated duration: ~2.1 minutes
  Pending mutations in queue: 3

No changes applied (dry-run mode)
```

**Step 3:** Require confirmation for mutations
```bash
$ npx hypequery migrate:deploy

⚠️  MUTATION DETECTED: orders.amount type change

This operation will rewrite 125 GB across 450 parts.
Estimated duration: ~2.1 minutes

Proceed? (y/N):
```

**Step 4:** Add `--yes` flag for CI/CD
```bash
npx hypequery migrate:deploy --yes   # Skip confirmations
```

**Files to Modify:**
```
packages/cli/src/commands/generate-migration.ts   # Show SQL preview
packages/cli/src/commands/migration-deploy.ts     # Add --dry-run, confirmation prompts
```

**Acceptance Criteria:**
- ✅ SQL always shown during generation
- ✅ `--dry-run` flag previews execution without applying
- ✅ Mutations require confirmation (unless `--yes`)
- ✅ Metadata ops skip confirmation
- ✅ Cost estimates shown in prompts

**AI Agent Safety Framing:**
> "Deterministic guardrails + always-visible SQL + confirmation for destructive ops = safe for AI agents"

---

#### 1.7 Down Migration Philosophy Documentation [1 day]
**Why:** Ambiguity destroys trust. Pick a stance and document it.

**Recommendation:** Forward-only + expand-migrate-contract

**Implementation:**
- Document philosophy in README
- Add expand-migrate-contract recipes:
  - Column rename: add new, backfill, drop old
  - Type widening: add new nullable, backfill, drop old
  - Key changes: create new table, migrate data, swap
- Remove "best-effort" language
- Keep auto-generated downs for safe ops (CREATE/DROP parity)
- Mark destructive ops as manual with recipes

**Files:**
```
packages/schema/README.md                     # Add philosophy section
packages/schema/docs/recipes.md               # Add expand-migrate-contract patterns
```

**Acceptance:**
- Clear documented stance
- Copy-paste recipes for common scenarios
- No ambiguous language

---

#### 1.4 Feature Support Matrix [1 day]
**Why:** Users need to know before adopting. Transparency builds trust.

**Implementation:**
- Create `FEATURE_SUPPORT.md`
- Document what's supported vs. not
- Link from README

**Content:**
```markdown
# ClickHouse Feature Support

## ✅ Fully Supported
- Column types: Int8-256, UInt8-256, Float, Decimal, String, FixedString, DateTime, UUID, IPv4/IPv6, Bool, JSON
- Type modifiers: Nullable, LowCardinality
- Engines: MergeTree, ReplacingMergeTree (generic)
- ON CLUSTER: Basic support
- Materialized views: Full lifecycle with dependency tracking
- TTL: Column and table level
- CODEC: All ClickHouse codecs
- Projections: Definition and lifecycle
- Skip indexes: All types

## ⚠️ Partial Support
- ReplicatedMergeTree: Generic support, no ZooKeeper path management
- Distributed tables: Basic, no topology awareness
- Complex types (Array, Map, Tuple, Nested, Enum): Via column.Raw() only

## ❌ Not Supported
- Dictionary engine
- Kafka/S3/URL engines
- Collapsing/Summing/Aggregating engine specifics
- User-defined functions
- Advanced replica coordination

## Escape Hatch
column.Raw('custom type') for unsupported types
```

**Acceptance:**
- Every ClickHouse feature has documented status
- Users know gaps before adoption

---

#### 1.5 Interactive Rename Detection [2 days]
**Why:** Column renames are common. Manual `--custom` is poor DX.

**Implementation:**
- Detect `PossibleColumnRename` in diff
- Prompt user: "Column 'new_name' added and 'old_name' removed. Is this a rename? (y/N)"
- If yes, generate:
  ```sql
  ALTER TABLE x RENAME COLUMN old_name TO new_name
  ```
- If no, proceed with add+drop

**Files:**
```
packages/cli/src/commands/generate-migration.ts  # Add interactive prompt
packages/schema/src/diff/diff.ts                 # Detect rename candidates
packages/schema/src/plan/plan.ts                 # Add RenameColumn operation
```

**Acceptance:**
- Detects renames (same type, similar position)
- Prompts interactively
- Generates efficient SQL
- CI mode (--yes-rename / --no-rename flags)

---

### Phase 2: SHOULD-HAVES (Fast-Follow) - 1 week

**Goal:** Match Drizzle DX bar, improve safety

#### 2.1 Shadow/Dev-DB Verification [3 days]
**Why:** Simulate migrations before production. Prisma/Atlas standard.

**Implementation:**
- Add `--dev-url` flag to `generate:migration`
- Before writing migration files:
  1. Create throwaway dev database
  2. Apply current schema
  3. Run generated migration
  4. Verify success
  5. Drop dev database
- Catch SQL errors before they hit production

**Files:**
```
packages/cli/src/commands/generate-migration.ts
packages/cli/src/utils/dev-db-verify.ts
```

**Acceptance:**
- Detects invalid SQL in dev
- Reports errors before file creation
- Optional (can skip with --skip-verify)

---

#### 2.2 Enhanced Cost Analysis [2 days]
**Why:** Expand the moat. Add more mutation warnings.

**Current State:**
- Warns on: bytes, rows, active parts, pending mutations, replica delay

**Add:**
- Estimate mutation time based on row count + ClickHouse performance curves
- Warn on MODIFY COLUMN for primary/order key columns (extremely expensive)
- Detect mutations that can be split (add nullable → backfill → alter not null)

**Files:**
```
packages/schema/src/plan/cost-analysis.ts      # New file
packages/schema/src/plan/plan.ts               # Integrate estimates
```

**Acceptance:**
- Shows estimated mutation time
- Flags slow mutations (>5 min, >1 hour)
- Suggests split strategies

---

#### 2.3 Complex Column Types [2 days]
**Why:** Stop forcing users to column.Raw() for common types.

**Implementation:**
```typescript
column.Array(column.String())
column.Map(column.String(), column.Int32())
column.Tuple([column.String(), column.Int32()])
column.Enum8(['pending', 'active', 'completed'])
column.Nested({ name: column.String(), value: column.Int32() })
```

**Files:**
```
packages/schema/src/schema/column.ts
packages/schema/src/snapshot/serialize.ts
```

**Acceptance:**
- Type-safe builders for Array, Map, Tuple, Enum, Nested
- Renders correct SQL
- Diffs detect changes

---

### Phase 3: NICE-TO-HAVES (Post-GA) - Ongoing

#### 3.1 Visual Studio (Drizzle Studio Clone)
**Why:** Drizzle Studio is beloved. Schema browser + migration timeline.

**Scope:** Separate package, web UI

---

#### 3.2 ReplicatedMergeTree Deep Support
**Why:** Production ClickHouse is replicated. Better support needed.

**Features:**
- ZooKeeper path management
- Replica name patterns
- alter_sync / mutations_sync settings
- Partial replica failure handling

---

#### 3.3 Migration Plan Linter
**Why:** Position as AI agent guardrails (Atlas angle).

**Features:**
- Policy rules (e.g., "no DROP TABLE without --force")
- JSON plan output for CI/CD
- Machine-readable diagnostics

---

## Implementation Priorities (REORDERED BY P0-P6)

### 🔴 CRITICAL PATH: P0 MUST COMPLETE FIRST (Week 1)

**⚠️ BLOCKING WORK - Nothing else starts until P0 is done**

- [ ] **Day 1-5:** 🔴 P0 - Fix unsafe MV drop/recreate (1.0)
  - Day 1-2: Add ALTER TABLE...MODIFY QUERY support
  - Day 3: Detect implicit .inner. MVs and Kafka sources
  - Day 4: Generate backfill recipes and warnings
  - Day 5: Tests, docs, validation

**P0 Exit Criteria:**
- ✅ MODIFY QUERY used when safe (no data gap)
- ✅ Drop/recreate blocked with ingestion pause warning
- ✅ Implicit MV recreation forbidden
- ✅ All tests pass

---

### Week 2-3: P1-P6 IMPLEMENTATION (Can Partially Parallelize)

**Week 2 (Days 6-12):**
- [ ] **Day 6-8:** 🟡 P1 - Live DB as diff authority (1.1)
  - Introspection before diff
  - Drift detection command
  - Abort on mismatch
- [ ] **Day 9-10:** 🟡 P2 - Cost classifier reframing (1.2)
  - Operation-type first formulas
  - CODEC/TTL conditional costs
  - Pending mutation surfacing
- [ ] **Day 11-12:** 🟡 P3 - Blue-green workflow (1.4)
  - EXCHANGE TABLES scaffolding
  - ZooKeeper path warnings

**Week 3 (Days 13-19):**
- [ ] **Day 13-16:** Advanced ClickHouse features (1.3)
  - Day 13: TTL support
  - Day 14: CODEC support
  - Day 15: Projections
  - Day 16: Skip indexes + Refreshable MVs (P4)
- [ ] **Day 17:** 🟢 P5 - ORDER BY append exception (1.5)
- [ ] **Day 18:** 🟢 P6 - Always show SQL + dry-run (1.6)
- [ ] **Day 19:** Documentation (1.7) + Feature matrix (1.8)

**Week 4 (Days 20-21): Polish & Fast-Follow**
- [ ] **Day 20:** Interactive rename detection (1.9)
- [ ] **Day 21:** Integration testing, bug fixes

---

### Week 5+: SHOULD-HAVES (Post-Core Launch)
- [ ] Shadow-DB verification (2.1) - 3 days
- [ ] Enhanced cost analysis (2.2) - 2 days
- [ ] Complex column types (2.3) - 2 days

### Post-GA: NICE-TO-HAVES
- Studio UI
- Deep ReplicatedMergeTree
- Migration linter

---

## Critical Path Summary

```
Week 1: P0 ONLY (ship blocker)
  └─ 1.0 Fix unsafe MV drop/recreate [5 days]

Week 2-3: P1-P6 + Features
  ├─ 1.1 Live DB diff authority (P1) [3 days]
  ├─ 1.2 Cost classifier reframe (P2) [2 days]
  ├─ 1.3 TTL/CODEC/Projections/RMVs [4 days]
  ├─ 1.4 Blue-green workflow (P3) [2 days]
  ├─ 1.5 ORDER BY append (P5) [1 day]
  ├─ 1.6 Always show SQL (P6) [1 day]
  ├─ 1.7 Down migration docs [1 day]
  └─ 1.8 Feature matrix [1 day]

Week 4: Polish
  └─ Integration testing + rename detection

TOTAL: ~3-4 weeks to production-ready
```

---

## Testing Strategy

### Phase 1 Test Requirements

1. **Drift Detection Tests**
   - Detects manually added tables
   - Detects type changes
   - Detects column additions/removals
   - Handles missing migration history

2. **Advanced Feature Tests**
   - TTL column and table level
   - CODEC all variants (ZSTD, LZ4, Delta, etc.)
   - Projections with complex selects
   - Skip indexes all types (bloom_filter, minmax, set, etc.)

3. **Rename Detection Tests**
   - Detects renames correctly
   - Handles false positives (different types)
   - CI mode works (flags)

### Integration Test Matrix

Test against real ClickHouse versions:
- 23.8 (current LTS)
- 24.3 (latest stable)
- 24.8+ (with lightweight UPDATEs)

Test scenarios:
- Simple table evolution
- MV dependency chains
- Cluster operations
- Partial failure recovery
- Large table mutations (with cost warnings)

---

## Launch Positioning

### Tagline
**"Safe, declarative ClickHouse migrations for TypeScript teams and AI agents"**

### Three Pillars

1. **TypeScript-Native**
   - Drizzle DX for ClickHouse
   - No hand-written ALTERs
   - Full type safety

2. **ClickHouse-Deep**
   - Engines, MVs, ON CLUSTER, replication
   - TTL, CODEC, projections, skip indexes
   - Production-ready for real workloads

3. **Cost-Aware** ⭐ THE MOAT
   - Analyzes table size before mutations
   - Warns before expensive operations
   - AI agent safety guardrails

### Marketing Angles

**For TypeScript Teams:**
> "Finally, Drizzle-quality migrations for ClickHouse. Declarative schema, automatic diffing, and the safety to sleep at night."

**For Data Engineers:**
> "The only ClickHouse migration tool that warns you before a column type change triggers a 2TB rewrite. Cost-aware by default."

**For AI/Agent Use Cases:**
> "Safe schema evolution for AI agents. Mutation-cost classifier prevents accidental expensive operations. Built for the agentic era."

**vs. golang-migrate:**
> "Stop hand-writing ALTERs. Automatic diffing + cost warnings you won't get anywhere else."

**vs. Atlas:**
> "TypeScript-native, free, and cost-aware. Atlas charges for ClickHouse support and doesn't read table statistics."

**vs. MooseStack:**
> "Just migrations, not a whole framework. Deeper cost analysis than simple destructive/safe binary."

---

## Success Metrics

### Pre-GA (Canary Tag Removal)
- ✅ All Phase 1 MUST-HAVES shipped
- ✅ 90%+ test coverage
- ✅ Tested against ClickHouse 23.8, 24.3, 24.8
- ✅ 10+ integration test scenarios passing
- ✅ Feature support matrix published
- ✅ Down migration philosophy documented

### Post-GA (6 months)
- 1,000+ npm downloads/week
- 100+ GitHub stars
- 5+ production deployments (known)
- 0 critical bugs reported
- Featured in ClickHouse community resources

### 12 months
- 10,000+ npm downloads/week
- 500+ GitHub stars
- Mentioned alongside Atlas/golang-migrate in comparisons
- Enterprise adoption (SaaS companies)

---

## Risk Mitigation

### Risk 1: ClickHouse Ships Native Migrations
**Likelihood:** Medium (clickhousectl is beta, could expand)
**Mitigation:**
- Lean into value-add (cost analysis, semantic layer integration)
- Position as "enterprise layer" on top of native tools
- TypeScript DX moat

### Risk 2: Atlas Adds Cost Analysis
**Likelihood:** Medium (they innovate fast)
**Mitigation:**
- We're Apache-2.0 and TS-native (always free, better DX)
- Semantic layer lock-in
- Move fast on Phase 2 features

### Risk 3: Adoption Too Slow
**Likelihood:** Medium (migration tools are conservative)
**Mitigation:**
- Publish comparison table (vs. Atlas, golang-migrate)
- Create demo videos (cost warnings preventing disasters)
- Target TS+ClickHouse shops explicitly (Vercel, PostHog users)

### Risk 4: Critical Bug in Production
**Likelihood:** Low (but impact catastrophic)
**Mitigation:**
- Extensive integration tests
- Shadow-DB verification (Phase 2.1)
- Clear "this is what we support" matrix
- Escape hatch (Raw SQL) for edge cases

---

## Files to Create/Modify

### Phase 1

**New Files:**
```
packages/cli/src/commands/migration-drift.ts
packages/schema/src/introspect/compare.ts
packages/schema/src/schema/ttl.ts
packages/schema/src/schema/codec.ts
packages/schema/src/schema/projection.ts
packages/schema/src/schema/skip-index.ts
packages/schema/docs/recipes.md
packages/schema/FEATURE_SUPPORT.md
```

**Modified Files:**
```
packages/schema/src/schema/column.ts         # Add TTL, CODEC
packages/schema/src/schema/define.ts         # Add projections, skipIndexes
packages/schema/src/snapshot/serialize.ts    # Serialize new features
packages/schema/src/diff/diff.ts             # Detect changes
packages/schema/src/plan/plan.ts             # Add RenameColumn
packages/schema/src/sql/render.ts            # Render SQL
packages/schema/README.md                    # Philosophy, features
packages/cli/src/commands/generate-migration.ts  # Interactive prompts
```

### Phase 2

**New Files:**
```
packages/cli/src/utils/dev-db-verify.ts
packages/schema/src/plan/cost-analysis.ts
packages/schema/src/schema/complex-types.ts
```

---

## Recommended Sequencing

**⚠️ CRITICAL: P0 Must Complete Before Any Other Work**

**This Week:**
1. ✅ Create production readiness plan with critical audit findings
2. Review P0 data-loss footgun with team
3. Get approval to start P0 work immediately

**Week 1: 🔴 P0 BLOCKING WORK**
- **Day 1-2:** Implement ALTER TABLE...MODIFY QUERY support
- **Day 3:** Add implicit MV and Kafka source detection
- **Day 4:** Generate backfill recipes and warnings
- **Day 5:** Tests, docs, validation
- **Exit criteria:** All P0 acceptance criteria met, tests passing

**Week 2-3: P1-P6 + Features**
- See detailed timeline in "Implementation Priorities" section above
- Can parallelize some work after P0 completes

**Week 4: Polish & Testing**
- Finish TTL
- CODEC, projections, skip indexes (6 days)
- Documentation updates (2 days)

**Week 3:**
- Interactive rename (2 days)
- Shadow-DB verification (3 days)
- Testing and polish (2 days)

**Week 4:**
- Drop canary tag
- Launch announcement
- Publish comparison table

---

## Disagreements with Competitive Report

### ✅ Agree
- Cost analysis is unique moat (validated against all competitors)
- TS-native is the wedge
- Trust gaps are bigger risk than feature gaps
- Forward-only philosophy is correct for ClickHouse

### ⚠️ Partially Agree
- "TTL/codec/projection likely gaps" - Confirmed gaps, high priority
- "Best-effort downs destroy trust" - Partly true, needs clear docs
- "Shadow-DB is critical" - Important but Phase 2
- "MV drop/recreate is valuable" - **WRONG: It's a data-loss footgun** (P0 finding)

### ❌ Disagree
- "Maturity gap is hardest commercial reality" - Quality > stars for migration tools
- "ClickHouse-only caps TAM" - Depth beats breadth, niche dominance strategy correct
- "Automatic MV drop/recreate is rare and valuable" - **DANGEROUS: Violates expert consensus, must fix**

---

## Critical Audit Corrections

**What the Competitive Report Got Wrong:**

1. **Automatic MV drop/recreate praised as strength** → Actually a **P0 data-loss footgun**
   - Violates universal expert consensus (dbt-clickhouse, Altinity, BigData Boutique)
   - Creates blind window for data loss
   - Must fix before ANY production usage

2. **Snapshot-diff presented as proven** → **Weaker than code↔live-DB for OLAP** (P1)
   - MooseStack explicitly rejects snapshot-diff for ClickHouse
   - OLAP DBs drift more than OLTP (manual ALTERs, ops interventions)

3. **Cost classifier described as "warns on large table mutations"** → **Framing is backwards** (P2)
   - Should be operation-type first, not size-first
   - 10 TB table with ADD COLUMN = instant
   - 50 GB table with MODIFY COLUMN type = full rewrite

**What the Audit Confirmed:**

1. ✅ **Cost-analysis moat is real and unique** - No competitor reads system.parts/system.mutations
2. ✅ **Forward-only philosophy is expert-aligned** - Matches MooseStack and parallel-change literature
3. ✅ **Mutation-risk taxonomy (metadata/mutation/data-copy/forbidden) is correct** - Maps to ClickHouse reality

---

## Conclusion (Updated Based on Audit)

**@hypequery/schema has 1 P0 BLOCKER + 60% production-ready features.**

**P0 Ship Blocker:**
- Automatic MV drop/recreate is a data-loss footgun
- **Must fix in Week 1 before any other work**
- Blocks all production usage until resolved

**After P0 Fix:**
The core architecture (schema DSL, snapshot diffing, cost analysis) is solid and unique. The remaining gaps are trust features (drift detection, TTL/CODEC/projections, blue-green workflow) addressable in 2-3 weeks.

**The moat is real and defensible (validated):**
- No competitor does mutation-cost analysis at operation level
- Reading pending mutations + replica delay is most defensible signal
- Position as "AI agent safety feature for the agentic analytics era"

**Recommended path:**

**Week 1: 🔴 P0 MUST COMPLETE FIRST**
1. Fix unsafe MV drop/recreate (5 days)
2. Add MODIFY QUERY support, detect Kafka/implicit MVs, generate backfill recipes
3. **Nothing else starts until P0 exit criteria met**

**Week 2-3: P1-P6 + Features**
4. Live DB as diff authority (P1) - 3 days
5. Cost classifier reframing (P2) - 2 days
6. TTL/CODEC/projections/RMVs - 4 days
7. Blue-green workflow (P3) - 2 days
8. ORDER BY append + Always show SQL (P5/P6) - 2 days
9. Documentation + feature matrix - 2 days

**Week 4: Polish & Launch**
10. Interactive rename detection - 1 day
11. Integration testing - 1 day
12. Drop canary tag
13. Launch with cost-analysis + AI safety positioning

**Target launch: 3-4 weeks from P0 start**

**Key Risk Mitigated:**
Expert audit prevented shipping data-loss footgun to production. P0 fix makes package genuinely safe for ClickHouse's irreversible mutation model.

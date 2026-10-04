# Fan-out-safe relationship aggregation (HQ-81)

- Date: 2026-10-04
- Status: Proposed; SQL proof only, public planner implementation pending
- Tracking: [HQ-81](https://linear.app/hypequery/issue/HQ-81/prevent-duplicate-counts-in-one-to-many-joins)
- Protocol proposal: [RFC 0016](../specs/security-protocol/rfc/0016-fanout-safe-relationship-aggregation.md)

## Problem and decision

A parent worth 10 with three children must still contribute 10 to its group's
parent revenue. `LEFT ANY JOIN` loses children; `SUM(DISTINCT amount)` loses
different parents with the same amount. A plain join followed by aggregation
duplicates parent values and can duplicate children when several parents reach
the same target. Deduplication must use row identity, separately for each owner
and each output group, before aggregating values.

Use owner population CTEs instead of hash-based symmetric arithmetic. Exact
key tuples avoid hash collisions and work for count, sum and average without
special numeric encoding. A dataset explicitly declares its physical row key;
authors separately opt into safe traversal on a relationship. Neither choice
alone enables traversal. Existing definitions keep their current behavior.

## Proposed TypeScript authoring

```ts
const Items = dataset('items', {
  source: 'items',
  tenantKey: 'tenant_id',
  primaryKey: ['tenant_id', 'item_id'],
  dimensions: { category: dimension.string(), amount: dimension.number() },
  measures: { revenue: measure.sum('amount'), count: measure.count() },
});
const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  primaryKey: ['tenant_id', 'order_id'],
  dimensions: { amount: dimension.number() },
  measures: { revenue: measure.sum('amount'), count: measure.count() },
  relationships: {
    items: hasMany(() => Items, {
      keys: [{ from: 'tenant_id', to: 'tenant_id' },
             { from: 'order_id', to: 'order_id' }],
      aggregation: 'deduplicate',
    }),
  },
});
// Proposed, not currently available:
await analytics.execute(Orders, {
  dimensions: ['items.category'],
  measures: ['revenue', 'count', 'items.revenue', 'items.count'],
});
```

`primaryKey` names physical columns, like relationship keys. It is a non-empty
readonly array, snapshotted at definition time, with safe, unique identifiers.
All components must be non-NULL and the complete tuple must be unique over the
visible source population. Include the tenant column when IDs repeat across
tenants; a runtime selecting several tenants must not collapse them.

## Execution stages

1. Validate the complete request and backend capability before cache lookup.
   Reject unsupported measure kinds, raw SQL, multi-hop paths and unsupported
   relationship combinations. Check target dimension/filter exposure normally.
2. Scope each source with its own runtime tenant predicate. Apply base segments
   and base filters; qualified query predicates apply after relationship
   expansion. Fixed measure filters affect only that measure's owner population.
   Joining across tenants is never allowed by a coincidentally equal row ID.
3. Validate non-NULL and unique primary-key tuples for every owner participating
   in deduplication. Fail before returning a value. The check and result must
   observe the same rows (see the snapshot requirement below).
4. Build a membership relation with group keys, parent key, target key and an
   explicit nullable match marker, using LEFT ALL JOIN rather than ANY. Match
   every equality key, plus the trusted tenant condition. SQL NULL keys never
   match. Project nullable target dimensions to avoid synthetic default groups
   under ClickHouse `join_use_nulls=0`.
5. For each owner, select DISTINCT `(group tuple, full owner key)` from membership.
   Omit unmatched targets. Rejoin that owner's scoped source once by its complete
   key, apply its measure's fixed filters, and aggregate original values. Dedup
   keys, not measure values. Compute average from original rows, not child counts
   or averages of groups. Keep separate populations for different measure filters.
6. Attach owner aggregates to the distinct group relation using NULL-safe group
   equality. Missing counts are 0; other missing aggregates are NULL. Compute
   local formulas only after their dependencies have independent aggregates.
   Sort and paginate last, reserving Serve's overfetch row inside its ceiling.

One parent can contribute once to each of several category groups. Group totals
therefore need not add up to the ungrouped total. The ungrouped total is recomputed
from the ungrouped membership relation, never summed from category results.

## First executable slice after acceptance

- One opted-in hasMany relationship, one hop, physical dimensions and base
  `sum`, `count`, `avg`, `min`, `max`, `countDistinct`, `approxCountDistinct`.
- Opted-in belongsTo can use the same owner-population strategy for currently
  forbidden duplicate-sensitive target aggregates. Existing belongsTo semantics
  remain unchanged unless opted in.
- Local derived measures over supported local base dependencies may follow the
  base slice. No cross-owner formula authoring in the first slice.
- Reject percentile/stddev/variance/argMin/argMax, SQL measures/dimensions,
  window/shift measures, time bucketing and combinations with another traversed
  relationship in the first slice. A countDistinct field remains distinct by
  value after deduplication by identity. Unsupported cases must fail clearly,
  never fall back to ANY or a plain aggregate over expanded rows.

Multiple relationships and windows are future expansions, not silent subsets
of the first release. HQ-82 stays blocked. This proof includes a sibling fan-out
counterexample to ensure the selected strategy can handle it later.

## Correctness and resource prerequisites

ClickHouse MergeTree ordering keys do not imply unique rows. Declared keys must
be checked, not inferred from ORDER BY or arbitrarily reduced with `any()`.
ReplacingMergeTree source visibility needs an explicit source policy; this
proposal does not implicitly add FINAL. A separate preflight query alone has a
write race. The production planner must use an execution snapshot or a single
materialized owner relation shared by key assertions and result evaluation;
otherwise it must refuse this capability. Ordinary ClickHouse CTEs can be
re-evaluated: writing a CTE twice is not proof of materialization. The SQL proof
uses immutable test tables and does not qualify this production requirement.

The membership relation can grow even though final results are bounded. Require
finite server-side intermediate-row, memory and execution-time ceilings with
cancellation propagated to all statements. Refuse factories unable to enforce
those limits. Result-limit and pagination settings alone are insufficient.
Record capability/plan diagnostics without leaking keys or tenant values.

Cache identity covers primary keys, relationship aggregation mode and the new
artifact versions. Successful result caches obey the existing freshness policy;
they do not establish permanent key uniqueness. Initial implementation should
bypass caching until snapshot/key assertion semantics are proven together.

## PR sequence and completion gates

1. **This PR:** proposed RFC, draft expected-row corpus and live ClickHouse SQL
   proof. No production export, wire grammar, or conformance claim changes.
2. **Protocol acceptance:** review open gates (snapshot strategy, intermediate
   bounds, version allocation); add canonical success/rejection/identity fixtures,
   then TypeScript and Python validators. Old artifact identities stay unchanged.
3. **Authoring:** primaryKey and explicit relationship mode, structural/type
   validation, snapshots, contract emission/rehydration and schema compatibility.
   New definitions refuse deployment to unsupported protocol versions.
4. **Planner:** validation/state/node/features integration; owner populations,
   snapshot-safe uniqueness assertions, tenant-safe equality joins, budgets,
   cancellation, opt-in capability and ground-truth live tests. Freeze unsupported
   backends explicitly. Never add an executor-specific ad hoc SQL bypass.
5. **Surfaces/release:** catalog queryability, safe projection, Serve schemas,
   React types, MCP, cache keys, docs and package changesets. Verify end-to-end
   discovery advertises only executable combinations.

HQ-81 is done only after the first executable slice is merged with these gates.
This design/proof PR starts the issue; it does not close it.

## SQL proof coverage

`packages/datasets/src/tests/integration/fanout-safe-aggregation-proof.test.ts`
compares candidate owner-population SQL against independent parent/child source
queries. Cases include equal-valued distinct parents and children, unequal child
multiplicity, NULL and unmatched groups, child filters, fixed measure filters,
tenant ID collisions, sibling Cartesian multiplication, empty populations and
duplicate/NULL key diagnostics. Both ClickHouse join_use_nulls settings must
produce identical results. The proof is intentionally separate from the current
public planner so a Proposed RFC cannot change accepted runtime semantics.

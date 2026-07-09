# Relationship-Aware Semantics Design

Date: 2026-07-02
Status: Implementation complete across PRs 1–3; documentation tracked separately

## Implementation status

- **PR 1 — DONE (2026-07-06).** Validation (dataset + metric paths), builder-path
  join planning, `QueryBuilderLike.leftJoin`, `PlanNode.joins` + semantic-planner
  emission, and the in-memory backend hash join. 19 new unit tests in
  `packages/datasets/src/relationships-query.test.ts`; full datasets/serve/mcp
  suites green. `PlanNode.joins` was pulled forward from PR 2 because the
  in-memory backend consumes it.
- **PR 2 — DONE (2026-07-06).** `@hypequery/clickhouse` `createBackend`
  translates `PlanNode.joins` into LEFT JOINs (base columns qualified with
  `source`, joined columns kept relationship-qualified and aliased to their
  quoted qualified name). GROUP BY is applied before aggregations to bypass the
  builder's alias-inference, which cannot parse quoted dotted aliases. 9 backend
  SQL tests (mock adapter) + 3 live ClickHouse integration cases (joined
  group-by, joined filter, joined tenant scoping).
- **PR 3 — DONE (2026-07-09).** Catalog/contract `queryable` + `fields`, serve
  `semantic-input-schema` enums, React field-name types, and MCP introspection.
- **PR 4 — TODO.** User-facing relationship documentation and stale semantic
  package/spec documentation updates.

Sources: `packages/datasets/src` (relationships, planners, validation, catalog, contract),
`packages/clickhouse/src` (query builder joins, semantic backend), `packages/schema/src/compat`,
`packages/serve/src/semantic/datasets`.

## Decision

Relationships become **executable for to-one hops only** (`belongsTo`, `hasOne`), as
**query-time LEFT JOINs**, for **dimensions, filters, and orderBy** — one hop deep.
`hasMany` stays metadata-only (catalog/contract/AI context) until a fan-out-safe
aggregation design exists. Measures and metric formulas stay on the base dataset.

Rationale: to-one joins never change the base table's row count, so every existing
aggregate stays correct with zero changes to measure semantics. `hasMany` traversal
multiplies base rows and silently corrupts `sum`/`avg`/`count` — the classic semantic-layer
fan-out trap. Industry practice (Cube, Looker) solves that with symmetric aggregates or
subquery pre-aggregation; that is a separate, deliberate follow-up.

## Current state (verified 2026-07-02)

- `belongsTo` / `hasMany` / `hasOne` (`datasets/src/relationships.ts`) produce
  `RelationshipDefinition { kind, target: () => dataset, from, to }` — metadata only.
- Surfaced in the catalog (`RelationshipCatalogEntry`) and semantic contract JSON
  (`ContractRelationship`), so MCP/AI consumers already see them.
- Schema compat validates join columns (`MissingRelationshipSourceColumn`,
  `MissingRelationshipTargetColumn`, `MissingRelationshipTargetSource` in
  `schema/src/compat/check.ts`).
- Not queryable anywhere: `validateDatasetQueryInput` and the metric `validateQuery`
  reject non-local field names; `PlanNode` (`semantic-plan.ts`) has no join node;
  `QueryBuilderLike` (`query-builder-protocol.ts`) has no join method.
- The ClickHouse builder itself already supports `innerJoin` / `leftJoin` /
  `withRelation` + `JoinRelationships` — execution capability exists below the protocol.

## Query surface

Relationship-qualified field names, using the **relationship name** (not the target
dataset name) as the prefix:

```ts
const Orders = dataset('orders', {
  source: 'orders',
  fields: { /* ... */ },
  relationships: {
    customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }),
  },
});

await analytics.execute(Orders, {
  dimensions: ['status', 'customer.country'],
  measures: ['revenue'],
  filters: [{ field: 'customer.tier', operator: 'eq', value: 'enterprise' }],
  orderBy: [{ field: 'customer.country', direction: 'asc' }],
});
```

- Result rows key joined columns by the qualified name exactly as requested
  (`row['customer.country']`). JSON keys with dots are unambiguous; SQL aliases are
  rendered with quoted identifiers (`AS "customer.country"` / backticks in ClickHouse).
- Only dimensions declared on the target dataset are addressable — the target's own
  `dimensions` map is the allowlist, same as local fields.
- One hop in v1: `customer.country` yes, `customer.region.name` no (explicit error).

## Semantics by feature

| Feature | v1 behavior |
|---|---|
| Dimensions | To-one qualified dimensions allowed; join added lazily only when referenced |
| Filters | Qualified fields allowed (WHERE on joined table, post-join = LEFT JOIN + WHERE) |
| orderBy | Qualified fields allowed iff selected as a dimension (existing orderable-fields rule) |
| Measures | Base dataset only; qualified measure names rejected with a clear error |
| Derived metrics | Formula inputs stay same-dataset; qualified *dimensions/filters* in the query flow through the aggregate input plan unchanged |
| `by(grain)` | Base dataset `timeKey` only (unchanged) |
| `hasMany` | Rejected at validation with: relationship exists but is not queryable (fan-out); metadata-only |
| Multi-hop | Rejected at validation with a "one hop" error |

Join type is always **LEFT JOIN**: base rows with NULL FKs survive (their joined
dimensions group under NULL), so measure totals never shrink because of a join.
Cardinality is trusted from the declaration — a mis-declared `belongsTo` over a
one-to-many FK can still fan out; docs must state that declaring cardinality is a
data-model contract, and compat checks cannot catch it.

### Tenancy

- Runtime tenant predicate applies to the base dataset exactly as today.
- If the **target** dataset declares a `tenantKey` and runtime tenancy is active, the
  planner adds the same tenant predicate on the joined table (defense in depth against
  cross-tenant leakage through joined dimensions).
- Explicit filters on the target's tenant column are rejected under runtime tenancy,
  mirroring the existing base-dataset rule.

### SQL-backed dimensions on the target

Rejected on both paths in v1 (the semantic backend path already rejects local SQL
dimensions; the builder path would need table-qualified expression rewriting to be safe).
Revisit alongside the SQL-expression lineage work in schema compat.

## Implementation plan

### 1. `@hypequery/datasets` — validation and planning

- `validateDatasetQueryInput` / metric `validateQuery`: parse `rel.field` names; resolve
  through `ds.relationships`; enforce to-one kind, single hop, target-dimension existence,
  target tenant rules. Unknown-field errors list qualified candidates.
- `query-planner.ts` / `dataset-query.ts` (builder path): when any qualified field is
  referenced, alias the base table, emit `leftJoin` per referenced relationship (deduped),
  table-qualify all columns (base included — required once two tables are in scope),
  and alias joined selections back to the qualified name.
- `semantic-planner.ts` / `semantic-plan.ts` (backend path): aggregate `PlanNode` gains

  ```ts
  joins?: Array<{
    relationship: string;   // alias used in qualified names
    source: string;         // target physical source
    from: string;           // base column (unqualified)
    to: string;             // target column (unqualified)
    type: 'left';
  }>;
  ```

  Dimension/filter/aggregation `field`s become table-qualified when `joins` is present.
- `in-memory-backend.ts`: hash-join implementation for to-one joins (needed for tests
  and any non-SQL backend parity).
- `sql-utils.ts`: qualified-alias rendering (`validateSQLIdentifier` currently rejects
  dots — add an explicit quoted-alias path rather than loosening identifier rules).

### 2. `QueryBuilderLike` protocol + ClickHouse backend

- Add `leftJoin(table: string, leftColumn: string, rightColumn: string, alias?: string)`
  to `QueryBuilderLike` as a **required** method (pre-release; the only known implementor
  is `@hypequery/clickhouse`, which already has it). Planner throws a capability error if
  a duck-typed builder lacks it and a qualified field is requested.
- `clickhouse/src/datasets.ts` (`createBackend`): translate `joins` in aggregate plans;
  derived plans inherit via their input plan. Extend live integration specs for joined
  base, derived, grouped, grained, and filtered queries.

### 3. Catalog, contract, serve, types

- Catalog: `RelationshipCatalogEntry` gains `queryable: boolean` (true for to-one) and
  `fields: string[]` (qualified dimension names). Contract mirrors it — MCP/AI context
  then advertises exactly what is executable.
- `serve/semantic-input-schema.ts`: qualified names join the dimension/filter/orderBy
  enums (keep the superset-safe mirror rule; enums only include queryable relationships).
- Type-level: extend `DatasetFieldNames<DS>` with `` `${RelName}.${TargetDimName}` ``
  template-literal names for to-one relationships. Keep helper types shallow — this
  multiplies name unions and can stress `tsc` (same risk class as production-plan Phase 3).
- Schema compat: join-column checks already exist; no new checks required for v1.
- Documentation is intentionally deferred to PR 4 so the metadata/type changes
  can be reviewed independently.

### 4. Until v1 lands

Improve the rejection message: when a filter/dimension matches `^(\w+)\.` and the prefix
is a declared relationship, say "relationships are not yet queryable" instead of the
generic unknown-field error.

## PR sequencing

| PR | Scope |
|----|-------|
| 1 | Validation + builder-path planning + protocol `leftJoin` + in-memory backend + unit/type tests |
| 2 | `PlanNode.joins` + ClickHouse backend translation + live integration specs |
| 3 | Catalog/contract `queryable` + serve enums + React field types + MCP introspection |
| 4 | User-facing docs page + stale package/spec documentation updates |

## Non-goals (v1)

- `hasMany` traversal and cross-dataset measures/metrics (needs fan-out-safe subquery
  aggregation — design separately before exposing).
- Multi-hop relationship paths.
- Inner/full join types, join-type overrides.
- SQL-backed dimensions on join targets.

## Risks

- Trusted cardinality: a wrong `belongsTo` declaration fans out silently. Mitigation:
  documentation + (follow-up) an optional dev-mode row-count assertion.
- Qualified aliases require quoted identifiers everywhere SQL is rendered (builder path,
  backend path, derived CTE passthrough columns).
- Enum growth in generated OpenAPI for wide target datasets; bounded by existing
  `limits.maxDimensions` payload guards.
- Template-literal field types over many relationships can slow type-checking.

## Acceptance criteria

- Qualified to-one dimensions/filters/orderBy execute correctly on both the query-builder
  path and the semantic-backend path, with identical result keys.
- `hasMany` and multi-hop queries fail validation with actionable messages.
- Runtime tenancy predicates apply to both sides of every join when both declare tenant keys.
- Catalog/contract mark relationship queryability; serve enums and MCP context match the
  validator exactly.
- Live ClickHouse integration covers joined base, derived, grouped, grained, and filtered
  queries.

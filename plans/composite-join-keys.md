# Composite join keys

Status: implemented locally; live ClickHouse integration verification pending. Package: `@hypequery/clickhouse` (currently 2.12.1).

## Review and recommendation

The reported limitation is present in this checkout. All five explicit join methods accept one left/right column pair. `JoinFeature.addJoin()` stores that pair, and `SqlFormatter.compileJoins()` emits one equality. Additional `on` predicates wrap ordinary values as literal value nodes; a string such as `children_cte.entity_id` is therefore a value, not a column reference.

Implement proposal A across `innerJoin`, `leftJoin`, `leftAnyJoin`, `rightJoin`, and `fullJoin`. Reuse the existing column and result-state types. This solves the multi-tenant aggregate use case without introducing a new expression language. Proposal B would require a column-reference node, expression compiler and compatibility updates, and contextual validation of referenced columns; `JoinConditionInput.value` is currently `unknown`, so simply accepting `col()` would not deliver equivalent type safety.

ClickHouse supports multiple equality predicates joined with `AND`. Its documentation also distinguishes `ON` predicates from `WHERE` filtering, which matters for preserving unmatched outer-join rows: https://clickhouse.com/docs/reference/statements/select/join#on-section-conditions. Do not claim support for every join algorithm without qualification: algorithm restrictions also depend on join type and strictness.

The existing joins documentation incorrectly says ClickHouse cannot support multiple join conditions and recommends `WHERE` as a workaround. Replace that section as part of this feature.

## Public API contract

Keep every existing single-pair signature. Add an overload accepting a non-empty readonly array of readonly column pairs:

```ts
builder.leftAnyJoin('children_cte', [
  ['tenant_id', 'children_cte.tenant_id'],
  ['entity_id', 'children_cte.entity_id'],
  ['sub_id', 'children_cte.parent_sub_id'],
]);

// Schema tables retain alias support; inputs use the table qualifier.
builder.leftAnyJoin('children', [
  ['tenant_id', 'children.tenant_id'],
  ['entity_id', 'children.entity_id'],
], 'c');

// LEFT and LEFT ANY retain their optional literal ON filters.
builder.leftJoin('children', [
  ['tenant_id', 'children.tenant_id'],
  ['entity_id', 'children.entity_id'],
], 'c', { column: 'c.status', operator: 'eq', value: 'active' });
```

- Pair left: `keyof BaseRow<State>`, matching today's contract.
- Pair right: `JoinRightColumn<State, TableName>`, restricted to the selected schema table or typed CTE.
- Shape: `readonly [Pair, ...Pair[]]`, where `Pair` is a readonly two-element tuple. Accept inline arrays and `as const` variables without requiring casts.
- Infer the target from the table argument; prevent invalid right qualifiers from widening target inference to another table. Include mixed-target rejection tests.
- Return `QueryBuilder<Schema, JoinResultState<State, TableName, Alias>>` exactly as today.
- Preserve `JoinAliasArg`: schema tables can take an alias; CTE targets cannot currently take one.
- Pair-form arguments are `(table, pairs, alias?, on?)` for LEFT/LEFT ANY and `(table, pairs, alias?)` for the other methods. Single-pair argument positions stay unchanged.
- Reject empty key arrays at compile time and runtime. Reject malformed pair shapes at runtime for JavaScript callers, with a clear error before SQL compilation.
- Match existing column-existence checking; do not add new column value-type compatibility constraints.

This scope covers separate-column composite keys. Comparing a tuple expression against a single tuple-valued key remains a future expression API; expose the aggregate's key components as individual typed CTE columns for this release. Composite relationship definitions and automatic `join()` traversal are also outside this scope.

## Implementation sequence

1. **Types and overloads.** Add focused pair/list types beside the join state types in `src/core/types/builder-state.ts`. Add overloads to the five methods in `src/core/query-builder.ts`, preserving legacy inference and argument inspection where possible. Existing type tests inspect `Parameters<typeof builder.innerJoin>`, so explicitly verify overload ordering. Export reusable public input types through `src/index.ts` if introduced as public API.

2. **Normalize input.** Put independently testable argument/pair normalization in a focused `src/core/utils/join-keys.ts` module. Dispatch on `Array.isArray`, validate pair shapes, copy caller arrays, and funnel both signatures through the existing `applyJoin()` state transition. Keep state-dependent alias/state work in the builder. Do not convert a pair array using `String()`.

3. **Extend the query node additively.** Keep required `JoinNode.leftColumn`, `rightColumn`, and optional `leftSource` as the first pair. Add optional `additionalKeys: Array<{ leftColumn: string; rightColumn: string }>` for remaining pairs. This avoids duplicating a full key list and preserves existing manually constructed single-pair nodes. Only populate the new field when needed. Apply table-to-alias rewriting to every right column, using an exact qualifier prefix match for new helper logic. Preserve the relationship traversal path through `addJoin()` and its `leftSource` handling.

4. **Compile and preserve keys.** Update `src/core/formatters/sql-formatter.ts` to render the first and additional pairs, in order, joined by `AND`, followed by the existing literal `on` expression. Key identifiers add no bound parameters. Apply `leftSource` qualification consistently to unqualified left keys. Update `src/core/query-node.ts` to deep-copy additional pair objects and `src/core/utils/query-config-compat.ts` to expose the additional keys in legacy inspection rather than silently losing them. Single-pair node/config output must remain unchanged.

5. **Tests, docs, release.** Add the acceptance coverage below, replace the misleading documentation section in `website-next/docs/query-building/joins.mdx`, and add schema-table, alias, typed CTE, and literal-filter examples. Add a minor changeset for `@hypequery/clickhouse`. Keep docs hand-maintained; the repository's TypeDoc output path is stale.

## Acceptance coverage

- Unit SQL coverage in `src/core/tests/query-builder.joins.test.ts`: one/two/three pairs, all five join methods, differing key names, alias rewriting on every right key, multiple aliased joins, and a typed aggregate CTE.
- Parameter coverage: key comparisons have no parameters; literal `on` filters stay bound; a string resembling a column reference remains a literal. Include CTE-body parameters plus ON/WHERE parameters to check ordering.
- Compatibility: unchanged legacy SQL and inferred result types, relationship-generated joins, `getQueryNode()`/`toQueryNode()` transforms, and complete `getConfig()` inspection. Mutating caller arrays or returned node key objects must not mutate the builder or a sibling query.
- Runtime errors: empty arrays and malformed pairs passed by JavaScript/untyped callers.
- Dedicated compiler type tests under `type-tests/`: valid schema and raw/builder typed CTE pairs; readonly stored tuples; alias result selection; rejected unknown left/right columns, undeclared/untyped CTEs, wrong/mixed target qualifiers, empty lists, malformed tuples, and CTE aliases. Exercise all five methods and the existing single-pair overloads. Cover a CTE used as the query's base source.
- ClickHouse integration in `src/core/tests/integration/complex-joins.test.ts`: same entity ID in different tenants, same tenant/entity with different sub IDs, distinct expected child aggregates, and an unmatched base row. Compare builder results against equivalent raw SQL. Add duplicate full keys in a separate LEFT ANY case to verify at-most-one match without asserting which duplicate wins. Use the existing integration fixture lifecycle.

## Validation and completion

Run `pnpm --filter @hypequery/clickhouse test:types`, `pnpm --filter @hypequery/clickhouse test:unit`, `pnpm --filter @hypequery/clickhouse build:main`, and `pnpm --filter @hypequery/clickhouse lint`. Run `pnpm test` for downstream consumers of query nodes and explicit join methods. Run `pnpm test:integration` with Docker available; report missing infrastructure if unavailable, rather than treating SQL snapshots as execution verification.

Done when the three-component typed CTE join needs no cast, all components appear in ON, tenant/sub-key collisions cannot select another aggregate, unmatched LEFT rows survive, existing single-pair calls retain their SQL and types, and docs plus the minor changeset are included.

## Implementation verification (2026-10-03)

Implemented the pair-array overloads for all five explicit join methods, additive query-node keys and cloning, legacy inspection, alias rewriting, runtime shape checks, focused helper modules, unit/type regressions, integration cases, docs, and a minor changeset.

- `pnpm build`: passed across all nine packages.
- `pnpm test`: passed across all nine packages (18 build/test tasks); ClickHouse has 735 passing unit tests plus its compiler type tests.
- `pnpm --filter @hypequery/clickhouse lint`: passed.
- `pnpm test:integration -- complex-joins.test.ts`: could not execute because Docker is not running. The new live cases remain unverified.

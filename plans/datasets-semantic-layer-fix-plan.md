# Datasets Semantic Layer Fix Plan

Date: 2026-05-24
Owner: TBD
Status: Implementation pass complete; follow-up hardening remains

## Pre-Release Bias

This package is still pre-release. Breaking changes are encouraged in this implementation pass when they materially improve API clarity, semantic correctness, and long-term maintainability. We should prefer a cleaner public surface over preserving accidental or weakly-defined pre-release behavior.

## Goals

- Fix broken derived metric SQL generation in `@hypequery/datasets`.
- Catch invalid semantic plans before query execution.
- Clarify the intended public API boundary for datasets.
- Centralize semantic planning so `@hypequery/serve` delegates to `@hypequery/datasets`.
- Connect `@hypequery/schema` physical truth to datasets compatibility checks.
- Add enough type, unit, integration, and DX coverage to keep the surface stable.

## Non-Goals

- Rebuild the ClickHouse query builder architecture in this pass.
- Add broad write support to Hypequery.
- Ship speculative API expansion without deciding the intended public surface first.

## Architecture Direction

- `@hypequery/datasets` owns semantic planning, invariants, and public API behavior.
- `@hypequery/clickhouse` query builder is the SQL construction and execution backend.
- Planner correctness must not depend on query-builder inference behavior.
- Public docs must match the published npm package exactly.
- This is not a query-builder change.
- The biggest residual architecture risk is duplicated planner logic between `@hypequery/datasets` and `@hypequery/serve`, not the tenant runtime simplification itself.

## Decisions Locked For This Pass

- `dataset.query(...)` will be removed from the public API for now.
- Filtered measures will be supported in this pass.
- Export-surface cleanup should happen now because the package is still pre-release.
- Serve runtime owns tenancy. Datasets should not expose a public API that pushes tenant ownership decisions onto consumers.
- Simplify the public tenancy runtime shape in this pass.
- Focus helper typing work on the existing generic helpers only. Do not introduce additive dataset-aware helper variants in this pass.

## Progress Snapshot

### Completed

- Fixed derived metric SQL generation so ungrouped derived metrics do not emit invalid grouping.
- Added planner-level derived query validation before execution.
- Added filtered measure support to `@hypequery/datasets`.
- Removed `dataset.query(...)` from the datasets public API.
- Simplified `SemanticTenantRuntime` to tenant identity only.
- Rejected explicit tenant filters when runtime tenancy is active.
- Cleaned the datasets root export surface and removed accidental planner-internal exports.
- Updated `@hypequery/serve` to stop depending on removed datasets planner exports.
- Moved serve semantic/planner runtime helpers into `utils` files to reduce endpoint and pipeline bulk.
- Centralized dataset endpoint query planning in `@hypequery/datasets` so serve no longer maintains a duplicate semantic query planner.
- Added dataset query helper APIs under `@hypequery/datasets/internal` as the intentional datasets/serve planning boundary.
- Added schema-to-datasets compatibility checks so physical schema changes can be checked against semantic models.
- Added semantic architecture/spec notes for datasets, serve, and schema.
- Removed new production casts from the dataset-query path and cleaned the touched serve semantic test helpers.
- Locked the root datasets export surface so dataset-query helpers and types do not appear as public user-facing APIs.
- Made the query-builder protocol execute path generic so metric execution does not need a result cast.
- Removed file-level type suppression and response `any` casts from the serve live semantic integration spec.
- Added types for the shared ClickHouse integration harness used by serve live tests.

### Verified In This Pass

- `pnpm exec vitest run --config vitest.config.ts src/datasets.test.ts`
- `npm test -- --run src/semantic/datasets/serve-integration.test.ts`
- `pnpm build` in `packages/datasets`
- `pnpm build` in `packages/serve`
- `SKIP_INTEGRATION_TESTS=true pnpm exec vitest run --config vitest.integration.config.ts src/semantic/datasets/serve-live.integration.spec.ts`
- `git diff --cached --check`

### In Progress

- Lock the intended datasets/schema public surface with stronger type-test coverage.
- Keep the semantic architecture spec current while implementation stabilizes.

### Remaining

- Broader type-safety tightening for derived metrics and existing generic helpers where it remains understandable.
- Docs and guide alignment across the repo.
- Fresh-consumer smoke coverage.
- Wider integration coverage for datasets and serve semantic endpoints.
- Deeper schema compatibility for SQL expressions and relationship join columns.
- Relationship-aware semantic execution remains out of scope until the base semantic surface is stable.

## Workstreams

### 1. Derived Metric Planning and Validation

Objective:
Fix derived metric SQL generation and add planner-level safety checks.

Implementation:
- Patch `packages/datasets/src/executor.ts`.
- Make `buildDerivedSQLViaBuilder()` compute the intended grouping shape explicitly.
- Ensure ungrouped derived metrics emit no `GROUP BY`.
- Ensure grouped and grained derived metrics only group by user-selected dimensions and `period`.
- Add planner invariants before SQL execution:
  - no aggregate alias may appear in `GROUP BY`
  - no duplicate `GROUP BY` expressions
  - no derived-metric CTE should contain grouping unless the user query groups or grains
- Extend `MetricExecutor.validate()` so it validates the planned query shape, not just the input contract.
- Fail invalid plans before execution and before `toSQL()` returns misleading SQL.

Acceptance criteria:
- `executor.toSQL(derivedMetric, {})` emits valid ungrouped SQL.
- `executor.run(derivedMetric, {})` executes successfully for base-aggregation-derived metrics.
- `executor.validate(...)` returns invalid for derived plans that violate planner invariants.

### 2. Public API Boundary Cleanup

Objective:
Make the datasets package surface deliberate and coherent.

Implementation:
- Remove `query()` and `DatasetQueryRef` from the published surface for now.
- Make unsupported query-ref-shaped inputs fail with explicit public errors instead of runtime crashes where defensive handling is still needed internally.
- Tighten `packages/datasets/src/index.ts` and `packages/datasets/package.json` exports.
- Stop exporting planner internals by default unless they are intentionally public and documented.

Acceptance criteria:
- No unsupported public API crashes with `TypeError`.
- Root exports are intentional, documented, and covered by type tests.
- Docs do not rely on unpublished deep imports.

### 3. Measure Options and Filtered Measure Decision

Objective:
Resolve the docs/API mismatch around filtered measures.

Implementation:
- Support filtered measures in this pass.
- Extend `MeasureOptions` in `packages/datasets/src/types.ts`.
- Update `packages/datasets/src/measure.ts`.
- Propagate measure-level filters through planning and execution.
- Define merge semantics between measure-level filters, query-level filters, and runtime tenant filters.
- Document the supported behavior and add tests.

Acceptance criteria:
- The docs match the shipped API.
- Measure filters are fully typed, planned, and executed correctly.

### 4. Derived Metric and Query Typing Tightening

Objective:
Move intended API guarantees from runtime checks into compile-time checks where practical.

Implementation:
- Tighten `DerivedMetricConfig.uses` in `packages/datasets/src/types.ts` so derived metrics only accept base metrics from the same dataset.
- Prevent cross-dataset metric references at compile time where possible.
- Prevent derived-from-derived references at compile time where possible.
- Improve typing around query dimensions, `orderBy.field`, and grain usage.
- Assess feasibility of tightening the existing generic helpers like `eq()` and `desc()`.
- Improve the generic helper typing if it stays reasonably simple and understandable.
- If the type-level complexity becomes disproportionate, keep the current generic helper behavior and document that limitation clearly.

Acceptance criteria:
- Invalid derived metric wiring fails in type tests.
- Invalid query fields fail in type tests where the API intends strong typing.
- If helper functions stay generic, docs clearly describe that limitation.

### 5. Tenant Filter Semantics

Objective:
Handle runtime tenant injection without duplicate predicates or ambiguous semantics.

Implementation:
- Patch tenant handling in `packages/datasets/src/executor.ts`.
- Make serve runtime tenancy authoritative.
- Reject explicit tenant filters in semantic queries when runtime tenancy enforcement is active.
- Simplify the public runtime tenant contract so consumers provide tenant identity, not tenant column policy.
- Remove public reliance on `ExecutionContext.runtime.tenant.column` and `handledByBuilder`.
- Derive tenant column behavior from dataset configuration plus serve-owned runtime semantics.
- Document the chosen rule.

Acceptance criteria:
- SQL does not emit duplicate tenant predicates.
- Conflicting tenant assumptions are rejected consistently.
- Tenant ownership is clear in the public API and docs.

### 6. Documentation and Fresh-Consumer DX Alignment

Objective:
Make copy-paste docs work against the published package.

Implementation:
- Update docs to import `MetricExecutor` from `@hypequery/datasets`.
- Replace outdated measure execution examples with the current `dataset.metric(...)` flow.
- Remove or rewrite write-based setup instructions that imply native write support.
- Prefer `url` over deprecated `host` in examples where applicable.
- Add explicit fixture-seeding guidance using external tooling when writes are required.

Acceptance criteria:
- A fresh consumer can follow the guide without immediate TypeScript failure.
- The guide does not imply unsupported write workflows through Hypequery.

## Test Plan

### Type Tests

Add dedicated datasets type tests covering:
- metric construction success/failure
- same-dataset base-metric-only derived metrics
- valid/invalid dimensions
- valid/invalid `orderBy.field`
- grain behavior with and without `timeKey`
- measure options support/rejection
- root export surface
- guide snippets as compile tests

### Unit Tests

Add datasets unit tests covering:
- base metric SQL generation
- derived metric SQL generation:
  - ungrouped
  - grouped
  - grained
  - grouped + grained
  - filtered
  - tenant-scoped
- validation failures:
  - unknown dimension
  - unknown filter field
  - invalid order field
  - invalid grain usage
  - invalid derived plans
- planner invariants
- removed/unsupported `DatasetQueryRef` behavior
- query-builder protocol compatibility
- tenant predicate behavior

### Integration Tests

Add ClickHouse-backed integration tests covering:
- connection smoke tests
- fixture lifecycle
- base metric execution
- derived metric execution
- grouped and grained derived metrics
- pre-execution validation failures
- one real-dataset semantic query
- fresh-consumer package importability checks

### DX and Docs Checks

Add CI checks for:
- fresh temp project install
- root import compile test
- unsupported subpath import rejection
- Node 22 ESM importability
- guide snippet compile checks

## Proposed Sequencing

### Phase 1: Critical Bug Fixes - Complete

- Derived metric planning fix
- Planner invariants
- Validation upgrade
- `DatasetQueryRef` removal / crash prevention
- Tenant filter duplication handling

### Phase 2: Surface Decisions - Complete For This Pass

- Remove `dataset.query(...)` surface
- Implement filtered measure support
- Decide helper typing scope based on feasibility assessment
- Trim root exports

### Phase 3: Planner Ownership and Schema Compatibility - Complete For This Pass

- Move dataset endpoint planning ownership into `@hypequery/datasets`
- Remove duplicated serve semantic planner code
- Add schema-to-datasets compatibility checks
- Document the package ownership model in the draft spec

### Phase 4: Type Safety and API Boundary Hardening - Next

- Derived metric typing tightening
- Query typing improvements
- Current-surface type-test expansion
- Schema compatibility type-test expansion
- Existing generic helper typing improvements where practical

### Phase 5: Docs and Consumer DX - After API Hardening

- Docs and examples rewrite
- Fresh-consumer smoke tests
- Root import compile test
- Unsupported subpath import rejection test
- Node 22 ESM importability test

### Phase 6: Coverage Expansion

- Dedicated type tests
- Focused unit tests
- Real integration tests
- CI hardening

### Phase 7: Relationship-Aware Semantics

- Define how dataset relationships participate in planning.
- Decide whether joins are query-time only, materialized/planned elsewhere, or initially metadata-only.
- Add compatibility checks for relationship join columns before enabling relationship-aware execution.

## Release Scoping

### This PR

- Derived metric SQL fix
- Validation for invalid derived plans
- `dataset.query(...)` public surface removal
- Filtered measure support
- Tenant runtime simplification and explicit tenant-filter rejection
- Serve planner unification around datasets-owned planning
- Schema-to-datasets compatibility checks
- Semantic architecture/spec notes

### Follow-up Hardening

- Docs corrections for current published API
- Derived metric compile-time restriction overhaul
- Existing generic helper typing tightening
- Fresh-consumer smoke tests
- Live ClickHouse semantic integration execution in an environment with Docker access
- Relationship-aware planning design

## Risks

- Tightening the export surface may break undocumented consumer usage, but this is acceptable while the packages are pre-release.
- Tightening derived metric typing may reject code that currently compiles.
- The `@hypequery/datasets/internal` subpath is still technically importable, so docs should clearly position it as unsupported package-integration surface rather than user-facing API.
- Schema compatibility can still miss deeper SQL-expression dependencies until the checker grows beyond direct column references.
- Adding filtered measure support expands the semantic API and test matrix materially.
- Relationship metadata remains non-executing until relationship-aware planning is deliberately designed.

## Open Questions

1. If tightening the existing generic helpers becomes too complex, should we explicitly defer helper typing improvements in this pass rather than force a brittle solution?

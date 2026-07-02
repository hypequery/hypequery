# Datasets Semantic Layer Fix Plan

Date: 2026-05-25 (status updated 2026-07-02)
Owner: TBD
Status: Items 1–3 of Next Work are complete (schema compatibility depth, docs + guide snippet compile checks, live CI). Item 4 (relationship-aware semantics) is designed in `relationship-aware-semantics-design.md` and awaits implementation.

## Pre-Release Bias

`@hypequery/datasets` and the semantic package boundary are still pre-release. Breaking changes are encouraged when they improve API clarity, semantic correctness, and maintainability.

## Architecture Direction

- `@hypequery/datasets` owns semantic planning, validation, and metric behavior.
- `@hypequery/serve` owns runtime delivery, auth, tenancy, transport, and endpoint policy.
- `@hypequery/schema` owns physical schema truth, snapshots, migration planning, and semantic compatibility checks.
- `@hypequery/clickhouse` owns relational query construction and execution.
- Dataset endpoint planning is a package-integration concern exposed through `@hypequery/datasets/internal`, not the public root datasets API.

## Completed

- Fixed derived metric SQL generation so ungrouped derived metrics no longer emit invalid `GROUP BY` clauses.
- Added planner-level derived query validation before execution.
- Added filtered measure support to `@hypequery/datasets`.
- Removed `dataset.query(...)` from the public datasets API.
- Simplified `SemanticTenantRuntime` to tenant identity only.
- Rejected explicit tenant filters when runtime tenancy is active.
- Cleaned the root datasets export surface and removed accidental planner-internal exports.
- Added `@hypequery/datasets/internal` for the intentional datasets-to-serve planning boundary.
- Updated serve dataset endpoints to use datasets-owned planning instead of duplicated serve planner logic.
- Removed duplicated serve semantic planner utilities.
- Added schema-to-datasets compatibility checks for physical schema changes.
- Added semantic architecture/spec notes for datasets, serve, and schema.
- Made `QueryBuilderLike.execute<T>()` generic so metric execution does not need result casts.
- Removed file-level type suppression and response `any` casts from touched semantic tests.
- Added types for the shared ClickHouse integration harness.
- Added fresh-consumer semantic smoke coverage for root imports, internal package-integration imports, unsupported deep imports, and Node ESM importability.
- Tightened existing generic query helpers so field/value literals are preserved more accurately.
- Added negative type tests for cross-dataset and derived-from-derived metric wiring.
- Split semantic consumer smoke fixture generation into `scripts/utils/write-semantic-consumer-fixtures.mjs`.

## Verified

- `npm test --workspace=@hypequery/datasets`
- `npm test --workspace=@hypequery/serve -- --run src/semantic/datasets/serve-integration.test.ts`
- `pnpm build` in `packages/datasets`
- `pnpm build` in `packages/serve`
- `SKIP_INTEGRATION_TESTS=true pnpm exec vitest run --config vitest.integration.config.ts src/semantic/datasets/serve-live.integration.spec.ts`
- `pnpm smoke:semantic-consumer`
- `git diff --cached --check`

## Current Caveat

Live ClickHouse execution has not been run in this environment because Docker socket access is blocked. The live semantic spec type-checks and can run in CI or a local environment with Docker access.

## Next Work

### 1. Schema Compatibility Depth — DONE

Completed in `packages/schema/src/compat/check.ts`: relationship join-column checks
(`MissingRelationshipSourceColumn`, `MissingRelationshipTargetColumn`,
`MissingRelationshipTargetSource`), simple SQL-column extraction, and
`LimitedSqlExpressionCompatibility` diagnostics for complex SQL expressions, with tests.

### 2. Docs and Guide Alignment — DONE

Datasets guides shipped to the website (`website-next/docs/datasets/`, PR #223).
Guide snippet compile checks added 2026-07-02: `pnpm smoke:docs-snippets`
(`scripts/smoke-docs-snippets.sh`) extracts every TypeScript block from the datasets
guides and type-checks them against the built packages; wired into `smoke:examples`
so CI runs it.

### 3. Live Integration and CI Hardening — DONE

CI (`.github/workflows/ci.yml`) runs a ClickHouse service container with live
integration suites for `@hypequery/clickhouse`, `@hypequery/datasets`, and
`@hypequery/serve`, plus `smoke:examples` (which includes `smoke:semantic-consumer`).

### 4. Relationship-Aware Semantics — DESIGNED, not implemented

Design finalized in `plans/relationship-aware-semantics-design.md` (2026-07-02):
to-one relationships (`belongsTo`, `hasOne`) become query-time LEFT JOINs for
dimensions/filters/orderBy, one hop deep; `hasMany` stays metadata-only until a
fan-out-safe design exists. Implementation is sequenced in that document.

## Release Scoping

### This PR

- Datasets public API boundary hardening.
- Internal datasets-to-serve planner boundary.
- Fresh-consumer semantic smoke coverage.
- Generic helper type preservation improvements.
- Derived metric type-test coverage for invalid wiring.

### Follow-Up Hardening

- Deeper schema compatibility for relationships and SQL expressions.
- Live ClickHouse semantic integration execution in Docker-capable CI.
- Docs corrections for current public API.
- Relationship-aware planning design.

## Risks

- Tightening the export surface may break undocumented consumer usage, but this is acceptable while the packages are pre-release.
- Tightening derived metric typing may reject code that currently compiles.
- The `@hypequery/datasets/internal` subpath is technically importable, so docs should clearly position it as unsupported package-integration surface rather than user-facing API.
- Schema compatibility can still miss deeper SQL-expression dependencies until the checker grows beyond direct column references.
- Relationship metadata remains non-executing until relationship-aware planning is deliberately designed.

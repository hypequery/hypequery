# Datasets Semantic Layer Fix Plan

Date: 2026-05-25
Owner: TBD
Status: Semantic API boundary and first type-hardening pass complete; schema depth, live CI, and docs remain

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

### 1. Schema Compatibility Depth

Objective:
Make schema compatibility catch more semantic breakage before migrations ship.

Implementation:
- Add compatibility checks for relationship join columns.
- Add safe dependency extraction for simple SQL-expression dimensions/measures where practical.
- Report explicit limitations for complex SQL expressions instead of pretending full SQL lineage exists.
- Add focused tests for removed/renamed join columns and SQL-expression limitations.

Acceptance criteria:
- Broken relationship join columns produce compatibility diagnostics.
- SQL-expression compatibility is either checked safely or reported as limited.

### 2. Docs and Guide Alignment

Objective:
Make public docs match the finalized package boundary.

Implementation:
- Document dataset definition, measures, filtered measures, metrics, derived metrics, `.by(grain)`, and `MetricExecutor`.
- Document serve-generated metric and dataset endpoints.
- Document runtime tenancy behavior and tenant-filter rejection.
- Avoid documenting `@hypequery/datasets/internal` as user-facing API.
- Remove write-based setup assumptions or move fixture seeding to external tooling such as `@clickhouse/client`.
- Add guide snippet compile checks after docs examples stabilize.

Acceptance criteria:
- Copy-paste examples compile from a fresh consumer project.
- Docs do not rely on removed root exports or unsupported deep imports.
- Docs do not imply Hypequery provides native write support.

### 3. Live Integration and CI Hardening

Objective:
Make semantic behavior continuously verifiable beyond unit tests.

Implementation:
- Run the live ClickHouse semantic integration suite in Docker-capable CI.
- Add CI coverage for `pnpm smoke:semantic-consumer`.
- Keep fast unit/type checks separate from Docker-backed integration checks.

Acceptance criteria:
- CI catches public API drift.
- CI catches live ClickHouse regressions for base, derived, grouped, grained, and filtered semantic queries.

### 4. Relationship-Aware Semantics

Objective:
Decide how dataset relationships participate in planning and execution.

Implementation:
- Define whether relationships are metadata-only, query-time joins, or a separate planned feature.
- Decide join semantics for dimensions, measures, filters, and derived metrics.
- Extend schema compatibility around relationship join columns before enabling execution.

Acceptance criteria:
- Relationship behavior is explicitly designed before being exposed as executable semantics.

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

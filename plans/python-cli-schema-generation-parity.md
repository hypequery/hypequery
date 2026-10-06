# Python CLI schema generation: TypeScript reference

Use the existing TypeScript implementation as the reference:

- [init](../packages/cli/src/commands/init.ts): table selection and dataset serving.
- [dataset generator](../packages/cli/src/generators/dataset-generator.ts): discovery, type mapping, semantic names and suggested measures.
- [generate datasets](../packages/cli/src/commands/generate-datasets.ts): regeneration and overwrite protection.
- [generator tests](../packages/cli/src/generators/dataset-generator.test.ts): authoring behavior.

## Shared contract

`hypequery init --path analytics --tables orders,customers` uses the actual
ClickHouse catalog. `--exclude-tables` omits tables; all tables are selected by
default (`--all-tables` is accepted explicitly). `--skip-connection` creates an
explicit offline demo. Connections use `CLICKHOUSE_*` environment variables.
Passwords and tokens are never written to definitions or schema snapshots.

Both languages preserve physical-column mappings, use camelCase semantic fields,
suggest `totalCount` plus `total<Field>` / `avg<Field>` for numeric value columns,
and exclude identifiers and coordinates from sum/average suggestions. Those
aggregates are suggestions, not inferred business metrics. Tenant-looking names
are reported, never silently converted to tenant policy. Serving requires auth.

## Python accuracy rules

Read `system.tables` and `system.columns` with bound database/table parameters
and readonly settings. Record exact source names/types in `schema.json`.
Report unsupported arrays/maps/tuples/aggregate states rather than assuming string.
Unwrap Nullable/LowCardinality for scalar mapping. Fail before writes on semantic
name collisions, invalid identifiers, missing tables or no supported scalar fields.

`totalCount` aggregates constant `1`, avoiding nullable-column undercounting.
It uses the SDK SQL-backed measure form, which cannot participate in relationship
joins; review/replace it when adding relationship measures. `time_key` prefers an
actual timestamp `created_at`, otherwise the sole timestamp. Multiple alternatives
require explicit review. Catalog metadata cannot infer business relationships or
trusted tenant boundaries.

Qualify sources with the actual database to avoid silently querying a different
source when runtime connection settings change. Refuse existing output paths and
roll back newly written files on failure. Discovery does not seed or modify data.

## Remaining TypeScript-only scope

Safe in-place `generate datasets --diff/--check/--force`, chDB, and context-auth
scaffolding remain separate Python work. Refresh by generating into a new directory
and reviewing the diff. Do not claim these capabilities as implemented in Python.

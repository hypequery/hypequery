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

## Regeneration contract

`hypequery generate datasets` writes `analytics/datasets.py`, matching the
TypeScript command's directory and using Python's file extension. `--output`
selects a file; `--path` selects a directory. Table inclusion and exclusion reuse
init's metadata discovery. Repeat the original selection on every regeneration.

`--check` and `--diff` never create directories or change files; drift or a missing
file exits 1. Equal contents exit 0 without changing the modification time.
Existing differing files require `--force`; force cannot be combined with either
read-only option. Writes use a private temporary file, exclusive creation or atomic
replacement, and cleanup on failure. Symlink destinations and parents are refused.
Replacement permissions never become more permissive.

Generation replaces definitions as a whole; review custom measures and relationships
before forcing. Unlike the TypeScript command, Python refuses to force-replace an
explicit `tenant_key` or keyword-unpacked settings that cannot be verified without
executing authored code, requiring a separate generated file and a manual merge.
Writes compare content and file identity with the pre-discovery snapshot; changes
or a newly created destination abort even with `--force`. A per-output lock directory
coordinates CLI writers through validation and replacement. It does not lock ordinary
editors: avoid editing definitions during regeneration. On a crashed invocation,
remove a leftover `.datasets.py.lock` directory only after confirming its owner stopped.
Competing generators may create shared parent directories without causing failure.
Tenant-column inference and automatic auth configuration remain unimplemented.
The `schema.json` from init is explicitly an initial discovery snapshot, not a
current catalog cache. Regeneration only updates the requested Python file.

## Remaining TypeScript-only scope

chDB, explicit tenant-column generation and context-auth scaffolding remain separate
Python work. Do not claim these capabilities as implemented in Python.

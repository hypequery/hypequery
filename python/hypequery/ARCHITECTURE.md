# Python datasets implementation guide

`create_dataset_client()` and `create_async_dataset_client()` are the canonical
entry points. Clients resolve targets and inputs, plan queries, manage cache
state, execute compiled queries and shape results. SQL compilation belongs to
the planner package and has no dependency on clients, caches or executors.

## Where changes belong

| Responsibility | Module under `src/hypequery/datasets/` |
| --- | --- |
| Dataset authoring and definition validation | `dataset.py`, `dimensions.py`, `measures.py`, `validation.py` |
| Request query model | `planner/query.py` |
| Execution admission: cancellation and expired deadlines | `planner/admission.py` |
| Query limits, reserved names and tenant capability validation | `planner/query_validation.py` |
| Field and relationship name resolution | `planner/resolution.py` |
| Filter value validation | `planner/filter_validation.py` |
| Per-query selections, joins, predicates and parameter allocation | `planner/compiler.py` |
| SQL fragment rendering, including grains and pagination | `planner/sql_fragments.py` |
| Identifier quoting and typed parameter binding | `planner/identifiers.py`, `planner/parameters.py` |
| Planning entry point and execution metadata | `planner/planner.py` |
| Client orchestration and tenant-bound clients | `client/clients.py`, `client/tenant_binding.py` |
| Target/input coercion and result shaping | `client/inputs.py`, `client/results.py` |
| Cache identity and storage | `cache/` |

`plan_dataset_query()` runs admission, limit and reserved-name checks before
creating a `DatasetQueryCompiler`. One compiler instance owns one query's mutable
SQL state. Its methods resolve fields, register single-match joins, allocate
typed parameters and produce SQL. The planning entry point wraps that output in
`CompiledQuery`, attaching settings, deadlines, cancellation and correlation
metadata. Clients then execute or cache it.

Validation is split by responsibility, preserving the existing rejection order.
Pure admission and contract checks do not allocate parameters. Field-specific
checks still occur during compilation as each field is resolved. Client
`validate()` plans without executing; cancelled or expired requests still raise
rather than being reported as invalid query inputs. Every execution plans before
cache lookup, so the cache cannot bypass admission or tenant validation.

Keep helpers that do not depend on compiler state in focused domain modules or
the nearest `utils/` directory. Behavior that owns or changes selections, joins
or parameter state stays on the compiler. Preserve the existing planner entry
point, aliases and package exports when moving implementations.

## Future dialect work

Compilation currently uses ClickHouse SQL and typed placeholders. Extract dialect
rendering from the compiler, SQL fragments, identifiers and parameter binding
without adding it to clients. Preserve tenant predicates on joined tables in
the join condition, single-match semantics and parameter allocation order.
Keep intentional SQL changes separate from structural extraction.

Python does not currently author TypeScript metric handles or named queries;
extend the existing Python dataset compilation path when adding Python features.

## Verification

Run `uv run pytest`, `uv run mypy`, `uv run ruff check .`,
`uv run ruff format --check .`, `uv run lint-imports` and
`uv run python scripts/check_sql_interpolation.py`. The import contracts enforce
the compiler's independence from orchestration and execution. Planner and client
tests cover SQL, parameter binding, tenancy, admission and cache behavior.
Changes to SQL semantics also need the relevant live ClickHouse tests.

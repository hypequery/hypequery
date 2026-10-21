# Changelog

## Unreleased

<!-- towncrier release notes start -->

## 0.1.0b1 (2026-10-17)

- Avoid terminating the process holding a dataset regeneration lock on Windows.
- Give the ClickHouse installation hint only when that driver is the missing app dependency, including when the executor factory reports it.
- Redact application import errors in development reload workers as well as initial startup.

- Add authenticated `add_client_contract_endpoint` discovery for installed strict
  client endpoints. Apply each target's role/scope/tenant policy before projection,
  sign the caller's authorized view, and return no-store responses that vary by
  credential transport. Keep metric-only/empty views valid, enforce a bounded
  response budget without truncation, and expose no tenant values or physical SQL.

- Add `hypequery export client-contract --factory module:factory` for offline
  canonical artifacts, including JSON-only stdout, bounded input/output handling,
  read-only drift checks and explicit atomic replacement. Validate both signed
  contracts and prepared identities, redact factory chatter/import failures, and
  preserve concurrent edits and file permissions without importing serving/driver
  extras. The explicitly named project factory should use definition-only SDK APIs.

- Add definition-only `ClientEndpointDefinition`, `ClientQueryProfile`, and
  `export_client_contract` APIs for deterministic frontend/MCP build artifacts.
  Export logical dimensions, safe related measures, target-authorized filters,
  metric output aliases, effective definition limits and ordered base defaults
  without importing FastAPI, connecting to ClickHouse, or exposing physical SQL.

- Add portable client-contract v1 models, bounded JSON decoding, canonical identities,
  and strict HTTP/MCP query validation for generated React and MCP integrations.
  Validate the same shapes, safe failures and query profile as TypeScript through
  a required shared conformance family.

- Add a runnable Python → generated React → HTTP MCP tutorial with tenant-scoped ClickHouse serving, decimal/null seed data, per-login browser cache isolation and installed-artifact preparation.

- Add opt-in `client_profile` bindings for Python dataset/metric endpoints and
  router/application client-contract export using resolved FastAPI paths.
  Enforce the advertised strict query profile, clamp against actual policy,
  client and production ceilings, and check `X-Hypequery-Client-Schema` only
  after authorization. Reject stale pins with a safe HTTP 409. Legacy endpoints
  retain their input behavior and are omitted from client exports. Add trusted
  `client_mount_path` configuration and the matching default CORS allow-header.

- Disable automatic ClickHouse driver sessions for owned query/control clients so overlapping HTTP and worker queries can share an executor without session-lock failures.

- Add `ClickHouseConnection.from_env()`, reading `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`,
  `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD` and
  `CLICKHOUSE_SECURE`. Malformed ports and booleans are refused by variable name. An
  unset port lets the driver choose 8123, or 8443 when secure. The CLI, project
  scaffolds and examples now use it, so scaffolded apps honour `CLICKHOUSE_SECURE`.
- ClickHouse executors are context managers (`with` / `async with`) that close their
  connections on exit.
- The async executor's cancellation-control connection now uses the same 2-second
  receive timeout as the sync executor's.

- Fix deployment contracts that widened a filter declared with an empty `operators`
  allow-list to every operator. The empty list now reaches protocol validation and is
  rejected, matching TypeScript, so a deployment can no longer accept filters the local
  planner refuses.

- Fix `hypequery init` and `hypequery generate datasets` emitting a SQL-backed
  `totalCount` measure without dependencies, which made every generated project fail
  to build a deployment contract and refused relationship joins. `totalCount` now
  counts the first supported non-nullable column. All-nullable tables instead
  receive the explicitly named `nonNullCount`, with a warning that it excludes nulls.

- Fix deployment of measure filters with integer values, such as
  `filter.gte("amount", 10)`, which failed with `HQ_VALUE_INTEGER_TAG_REQUIRED`. An
  exactly representable integer now publishes as the same binary64 number TypeScript
  writes, with an identical deployment identity. Integers beyond 2**53 are refused with
  a clear error rather than rounded.

- `TenantDatasetClient.execute` and `AsyncTenantDatasetClient.execute` accept
  `paginate=True`, as the unbound clients do, so request handlers holding a
  tenant-bound client can fetch pages with `has_more` metadata.

- Bind timestamp parameters as Unix seconds. RFC 3339 filter values such as
  `2026-10-25T01:30:00Z` were rejected by ClickHouse, and aware datetimes could
  resolve to the wrong instant on a non-UTC server in a repeated daylight-saving
  hour. Values without an offset are passed through unchanged.
- Add `run_dev` and `python -m hypequery.serve.dev app:app` for local
  development. The runner binds to loopback by default, warns with
  `ExternalBindWarning` when bound beyond it, supports `--reload`, and refuses
  apps created with a `ProductionProfile`.
- Add a README Getting started path from install to a served dataset, run as
  written from a built wheel against ClickHouse in CI.
- Add a validated ASGI production profile and Uvicorn runner with explicit bind
  and proxy trust, startup refusals for debug/docs/reload/cookie auth, bounded
  admission, cancellation-aware deadlines and database/HTTP result ceilings.
- Qualify shared HTTP fixtures under the production profile, test the real runner
  and add the production HTTP path to the live ClickHouse matrix.
- Add authenticated dataset and measure-backed metric HTTP endpoints with role,
  scope, tenant, and page-size policy; support synchronous and asynchronous clients.
- Add accurate over-fetch pagination without changing ordinary client executions.
- Return public operational metadata separately from authorized, audited, redacted
  SQL diagnostics. Semantic measures use strings on the HTTP wire, matching
  TypeScript; local client result values retain their native types.
- Propagate disconnect and handler cancellation to execution; optionally emit
  validated, metadata-only RFC 0011 success and failure events.
- Add bounded logical discovery and an application factory with docs and OpenAPI
  disabled by default. Development documentation requires explicit opt-in.
- Run shared semantic HTTP fixtures in Python and TypeScript CI, including the
  FastAPI and Uvicorn floors.

- **Breaking (pre-release):** every authoring helper now lives in exactly one
  namespace: `dimension.*`, `measure.*`, `filter.*`, `order.*` and the new
  `formula.*` (`formula.divide`, `formula.null_if_zero`, `formula.round`, …).
  `hypequery.datasets` no longer re-exports the loose helpers. That covers the
  aggregations (`sum`, `count`, `min`, `max`, …), the filters (`eq`, `in_list`, …),
  the orderings (`asc`, `desc`) and the formula functions (`divide`, `round`, …).
  The package no longer shadows Python builtins such as `sum`, `min`, `max` and
  `round`. Write `measure.sum("amount")`, `filter.eq("status", "paid")`,
  `order.desc("revenue")` and `measure.derived(formula.divide("a", "b"))`.
- **Breaking (pre-release):** `hypequery.serve.validate_correlation_id` is now
  `sanitize_correlation_id`. The new name says it returns the caller's id or `None`
  instead of raising. It no longer shares a name with the planner's
  `validate_correlation_id`, which raises.
- `create_api` and `start_server` are now the definitions, matching TypeScript, and
  their error messages use those names. `create_router` and `run_production` remain
  as aliases.

- Add `measure.derived(formula)` over local numeric measures, including validated references/dependency cycles, aggregate planning, HAVING, HTTP serving, and safe discovery.
- Emit derived formulas and inputs in catalogs, semantic snapshots and deployment contract 2, with shared TypeScript fixtures. Chained derived measures execute locally but cannot be exported under contract 2; relationship traversal remains limited to base measures.
- Formula limits and literal types match TypeScript: at most 256 nodes and 16 levels per formula, and integer literals keep integer arithmetic (`add("orders", 1)` returns an integer).

- Serialize relationship-qualified measures as strings (preserving NULL), like
  local measures, without changing dimension values or native client results.
- Allow `X-Include-Meta` in the default CORS request-header policy so React
  infinite dataset and metric queries can request pagination across origins.
- Stop suggesting `totalCount` for tables with no supported non-nullable column.
  Generate `nonNullCount` with an explicit warning instead, and use it in the
  scaffold example. It counts non-null values, not every row. Review existing
  `totalCount` references when regenerating definitions for these tables.

- Add explicit `time_grains` policies to Python datasets, enforced by the planner and dataset/metric HTTP endpoints and reflected in catalogs, semantic contracts and OpenAPI. Unsupported grains are rejected with TypeScript's message, `Unsupported time grain "hour". Supported: day, month`.
- Deployment export refuses a policy that excludes any day-through-year grain, because contract 2 cannot preserve it. A policy that includes every one of those grains publishes unchanged, matching TypeScript.

- Add validated query and client timezones (UTC by default), apply the zone to time buckets and local time-key filter bounds, and accept timezone overrides on dataset and metric HTTP endpoints.
- **Behavior change:** time buckets and offset-free time-key bounds previously used the column's or server's timezone; they now use the query zone, UTC unless set. Pass `timezone=` to `create_dataset_client` to keep a non-UTC zone. Persistent result caches populated before upgrading can return old buckets until their entries expire.
- Partition non-UTC cached results using the same deployed-identity convention as TypeScript.

- **Behavior change:** `minute`, `hour` and `day` buckets now return `period` as wall-clock text in the query timezone, `YYYY-MM-DD HH:MM:SS` (RFC 0015), matching TypeScript. They were previously UTC ISO instants such as `2026-01-02T05:00:00+00:00`. Week-and-longer buckets are unchanged (`YYYY-MM-DD`). A shared fixture, `specs/datasets/period-format-v1.json`, now pins the form in both languages.

- Add Python release automation with opt-in canaries after successful main CI,
  tagged beta/RC/stable releases, build-only rehearsals, artifact and CLI checks,
  and token-free PyPI Trusted Publishing.
- Prepare Python beta/stable release PRs with Towncrier, explicit version
  selection, synchronized package metadata and lockfile, preserved changelog
  history, and Python CI against the generated release commit.

- Audit locked and minimum runtime dependency resolutions across supported Python versions, and retain release SBOMs, audit reports and distribution checksums.
- Require urllib3 2.8.0 or newer for ClickHouse execution, fixing three published advisories. Raise core and serving dependency floors to the versions qualified by the beta suite.

- Preserve nulls for unmatched related dimensions and filters independently of ClickHouse `join_use_nulls`, including queries without related measures. Missing or other-tenant targets no longer appear as empty strings or zero values.

- `ResultCache(on_error=...)` observes cache failures that would otherwise be silent.
  Failures still never fail a query. The hook receives the stage (`"key"`, `"get"` or
  `"put"`) and the exception; without it, failures are logged at debug level by
  exception type only. `ExecuteOptions` types the options tenant-bound clients
  forward, and `DEFAULT_PAGE_SIZE` names the default page size.

- Select one-hop relationship base measures as `<relationship>.<measure>`,
  matching `@hypequery/datasets`. Duplicate-insensitive aggregates are allowed
  through `belongs_to` and every aggregate through `has_one`. Unmatched target
  rows never feed an aggregate, and target tenant and fixed-filter scoping are
  preserved. Catalogs, ordering and discovery advertise the safe names.
- Reject a query that selects one name as both a dimension and a measure.

- Add `having` conditions on selected measure values, matching
  `@hypequery/datasets` (HQ-329). Operators are `eq`, `neq`, `gt`, `gte`, `lt`,
  `lte`, `between`, `in` and `notIn`. Values are finite numbers bound as
  parameters, and conditions count against `max_filters`. Dataset endpoints
  forward `having`; metric endpoints refuse it. Queries with conditions bypass
  the result cache until the cache preimage carries them.
- Support composite relationship keys (RFC 0016), matching `@hypequery/datasets`.
  Pass `keys=(("customer_id", "id"), ("region_code", "region"))` to a
  relationship helper; every pair is AND-ed in the join, and related-measure
  projections keep every target key. Catalogs, semantic contracts and
  deployment contracts carry `keys`, and protocol validation accepts and checks
  them. Single-key relationships are unchanged.

- Align Python CLI names with TypeScript: `init --path`, `dev --hostname`, `-p`,
  `--no-watch`, `-V` and `help [command]`; preserve positional destinations,
  `--host` and `--no-reload` as aliases.
- Add framework-free `hypequery` and `python -m hypequery` CLI entry points,
  help/version and the `init`/`dev` command contract (PYE-01A).

- Add `hypequery init [directory]` with packaged Python project templates,
  authenticated orders endpoint, setup instructions and collision protection (PYE-01B).
- Inspect the configured ClickHouse schema during `hypequery init`, generate typed
  dataset definitions and a schema snapshot, and serve selected tables through
  authenticated endpoints. Match TypeScript's table selection and semantic naming;
  report unsupported columns, collisions and tenant candidates. Count nullable
  rows accurately. The offline demo requires `--skip-connection`.

- Add `hypequery dev [module:app]` with reload enabled by default, safe local
  runner policies, `--no-reload`, and actionable startup errors (PYE-01C).

- Gate Python CLI onboarding on wheel/sdist installs outside the checkout across
  Python 3.11–3.14, including a real authenticated ClickHouse query (PYE-01D).
- Verify schema-backed generation from installed wheel/sdist, serve discovered
  tables, and compare query results with raw ClickHouse SQL. Keep explicit offline
  example checks for base installations without driver extras.

- Align Python public authoring names with TypeScript: add `dataset`,
  `dimension.string/number/boolean/timestamp`, base `measure` helpers, `filter`
  and `order` namespaces, `create_memory_cache_store`, `create_api`, endpoint
  factories, `serve_dev`, and `start_server`. Existing
  constructors, callable dimension helpers and `run_dev` remain available; use the
  namespaces above for aggregation, filter, ordering and formula helpers.

- Add `hypequery generate datasets` (alias `generate:datasets`) using live ClickHouse
  metadata, with TypeScript-equivalent `--output`, `--path`, table selection, `--diff`,
  `--check`, `--force` and `--tenant-column` options. It defaults to `datasets.py`, matching the project
  layout created by `hypequery init`. Read-only drift checks exit 1 without writing;
  replacement is atomic and preserves the existing file's permissions. `--force`
  replaces the whole file and warns when it removes a configured `tenant_key`;
  `--tenant-column` sets `tenant_key` on tables that have that column and reports
  tables that do not.
- Reject destinations changed during discovery or writing, coordinate CLI writers
  through replacement, and accept concurrently created parent directories. Installed
  wheel/sdist journeys now restart serving and compare the regenerated column's query
  response with raw SQL.

- Add explicit synchronous and asynchronous relationship uniqueness checks. Checks respect trusted tenant scopes, deadlines and cancellation, validate complete composite target keys, and report duplicate to-one keys without automatically running database queries.

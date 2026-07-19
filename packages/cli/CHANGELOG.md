# @hypequery/cli

## 1.9.1

### Patch Changes

- Updated dependencies [268818b]
- Updated dependencies [7afcf16]
  - @hypequery/deployment@0.2.0
  - @hypequery/protocol@0.6.0

## 1.9.0

### Minor Changes

- 7c4be46: Add authenticated, idempotent streaming submission of verified deployment
  bundles and target-bound releases.

## 1.8.0

### Minor Changes

- 3a8cad6: Add deterministic target-bound deployment release envelopes and a CLI command
  that prepares them only from fully verified deployment bundles.

### Patch Changes

- Updated dependencies [3a8cad6]
  - @hypequery/protocol@0.5.0

## 1.7.0

### Minor Changes

- b92a0a1: Add versioned deployment bundle manifests, canonical identities, deterministic
  bundle directory builds, and strict filesystem verification for deployment and
  runtime artifact bytes.

### Patch Changes

- Updated dependencies [b92a0a1]
  - @hypequery/protocol@0.4.0

## 1.6.0

### Minor Changes

- fdec655: Build deterministic Node runtime artifacts automatically when deployment metadata references Serve handlers.

## 1.5.0

### Minor Changes

- 05d2a4d: Add canonical deployment contract encoding and domain-separated identities, expose deployment generation on Serve APIs, and add CLI build and validation commands for deployment artifacts.

### Patch Changes

- Updated dependencies [05d2a4d]
  - @hypequery/protocol@0.3.0

## 1.4.0

### Minor Changes

- 28e5abe: `hypequery init --database chdb` scaffolds a project straight onto embedded ClickHouse (chDB) — no server or credentials, and no `.env` is created or updated. The scaffolded `client.ts` uses `createQueryBuilder({ adapter: chdbAdapter({ session }) })` from `chdb/hypequery`, `chdb` is installed as a scaffold dependency instead of relying on `CLICKHOUSE_*` env vars, and the credential prompts are replaced by a single storage question (in-memory by default, or an on-disk session directory such as `./analytics.chdb` via `--chdb-path`).

  `hypequery generate --database chdb [--chdb-path <dir>]` introspects the embedded session — the type generator's client seam is now satisfiable by a chDB session, so schema types regenerate without an HTTP connection. Persistent sessions are selected explicitly with `--chdb-path`; in-memory sessions remain process-local and start empty in a later CLI invocation. Dependency-based detection produces an actionable explicit-command hint rather than silently opening an empty session. Dataset scaffolding during `init` uses the same embedded introspection client instead of falling back to an HTTP ClickHouse connection. `chdb` stays out of the CLI's own dependencies; it is resolved dynamically from the user's project and a missing install produces an actionable error instead of a resolution failure.

## 1.3.1

### Patch Changes

- 688a9e2: Harden logging and diagnostics without changing public APIs: never mark
  authenticated or tenant-aware responses as publicly cacheable, log the
  parameterized SQL template instead of a value-substituted string, and redact
  connection URLs in CLI output and error messages.

## 1.3.0

### Minor Changes

- d7259f0: Tighten semantic API type inference, add projection-aware dataset and metric result
  types, preserve projected rows through React analytics hooks, and add static manifest
  generation for Next.js clients.

  BREAKING (types only, no runtime change): dataset and metric result rows are now
  projection-typed. `DatasetQueryResultFor` / `MetricResultFor` rows — including the
  `output` types produced by `InferApiType` / `InferAPIType` and the result of
  `createDatasetClient().execute()` — no longer expose dimension keys or `period`
  unless the query selects them via `dimensions` / `by`. Code that read dimension
  fields off default (non-projected) result types must now pass the projection in
  the query it executes.

## 1.2.1

### Patch Changes

- b116f9d: Improve `generate:datasets` measure heuristics so ID and coordinate columns are emitted as dimensions but not nonsensical sum/avg measures.

## 1.2.0

### Minor Changes

- 75349dd: Add first-class semantic dataset scaffolding to the CLI.

  - `hypequery init` can now scaffold either the query or dataset workflow, select
    ClickHouse tables, generate an API entrypoint, and optionally add a
    context-based authentication scaffold.
  - Add `hypequery generate:datasets` for generating typed dataset definitions
    from an existing ClickHouse schema, with include/exclude table controls.
  - Improve project discovery, generated ClickHouse type handling, prompts, and
    dependency installation for the new scaffold layouts.

## 1.1.2

### Patch Changes

- 29761f3: Release `@hypequery/clickhouse` as `2.0.0` and include the related CLI patch release.

  For `@hypequery/clickhouse`, this release includes:

  - a refactor toward an explicit query-node internal model
  - stricter `withRelation()` behavior for chained relationships
  - stricter tuple `IN` validation and improved empty-set filter semantics
  - additive `groupBy()` behavior and improved aggregation inference
  - support for ClickHouse-native builder features such as `arrayJoin()`, `leftArrayJoin()`, `limitBy()`, and `withTotals()`
  - exported built-in time-bucketing helpers such as `toStartOfMinute()` through `toStartOfYear()`
  - `url` as the preferred ClickHouse connection field, while keeping deprecated `host` compatibility

  For `@hypequery/cli`, this release includes:

  - stricter non-interactive setup behavior with cleaner failure paths
  - NodeNext-safe generated scaffold imports
  - improved scaffold dependency installation, including `zod` and aligned canary sibling versions
  - support for `--skip-connection` during init scaffolding

- Updated dependencies [29761f3]
  - @hypequery/clickhouse@2.0.0

## 1.1.2

### Patch Changes

- Harden the CLI for release and generated scaffold reliability. This includes:

  - stricter non-interactive `init` behavior, including cleaner failure paths when connection validation fails
  - support for `--skip-connection` during scaffolding
  - NodeNext-safe generated relative imports such as `./client.js` and `./schema.js`
  - improved scaffold dependency installation, including `zod`
  - aligned canary scaffold dependency versions when scaffolding from a canary CLI build
  - cleaner cancellation and overwrite flows during interactive setup

## 1.1.1

### Patch Changes

- cfaa3c5: Fix tuple type inference in generated types from the `hypequery generate` command to properly render positional tuple types instead of falling back to `string`. This includes:

  - Added helper functions `splitTopLevelArgs`, `unwrapType`, and `getPrimitiveTsType` for better maintainability
  - Added support for `Tuple(...)` types to render as positional TypeScript tuple types
  - Added support for `LowCardinality` wrapper types
  - Added support for nested tuple types within `Array`, `Map`, and `Nullable` wrappers
  - Added test coverage for tuple type inference scenarios

## 1.1.0

### Minor Changes

- 66a6ca4: Update the CLI scaffolding and package guidance to use the current `initServe()` + `query({ ... })` + `serve({ queries })` path by default.

  - generate `analytics/queries.ts` templates that destructure `{ query, serve }` from `initServe(...)`
  - scaffold example queries using object-style `query({ ... })` definitions instead of the older chained builder-first serve style
  - emit an exported `api = serve({ queries: { ... } })` shape by default
  - align CLI docs and generated comments with the current main-path docs and dev workflow

  This makes new projects start on the current serve/query API without needing a separate migration step after scaffolding.

### Patch Changes

- Updated dependencies [66a6ca4]
  - @hypequery/serve@0.2.0

## 1.0.0

### Patch Changes

- Updated dependencies [cc466d5]
  - @hypequery/clickhouse@1.6.0

## 0.0.9

### Patch Changes

- Re-release to ensure CI builds `dist` artifacts before publishing so the CLI ships with compiled sources.

## 0.0.8

### Patch Changes

- 4bbab53: Enable query execution stats logging in dev server. Removed "Coming soon!" placeholder as the feature is already implemented via `serveDev`.
- Updated dependencies [4bbab53]
  - @hypequery/serve@0.0.7

## 0.0.7

### Patch Changes

- f99e80e: Pre-release improvements:
  - CLI loading spinners, serve runtime fixes, and React integration updates
- Updated dependencies [f99e80e]
  - @hypequery/serve@0.0.4

# @hypequery/cli

## 1.18.0

### Minor Changes

- 40eacb9: Generate valid TypeScript for pretty-printed ClickHouse types and infer named
  `Tuple(...)` values as objects in generated records, query results, and inserts.

  `DESCRIBE TABLE` returns wide types pretty-printed across several lines. Those
  were embedded in single-quoted string literals, so any table with a multi-line
  type produced a schema file that did not compile. Type literals are now
  serialized with `JSON.stringify`, which escapes newlines and quotes together.

  Named tuples are also inferred structurally instead of positionally, matching
  what ClickHouse actually returns over `JSONEachRow`. For a column typed
  `Array(Tuple(installed_version String, path Nullable(String)))`, the record
  interface the CLI writes changes from:

  ```ts
  'versions': Array<[string, string]>;                              // before
  'versions': Array<{ installed_version: string; path: string | null }>;  // after
  ```

  **Potentially breaking for `@hypequery/clickhouse`.** `InferClickHouseType`
  previously resolved a named tuple to a positional tuple whose elements were
  `never`. Positional reads compiled, because `never` is assignable to anything,
  but carried no type information. They are now property accesses:

  ```ts
  // before — compiled, inferred `never`
  const version = row.versions[0][0];

  // after
  const version = row.versions[0].installed_version;
  ```

  `InsertValue` changes the same way, but nothing that typechecked before stops
  typechecking: its named-tuple elements were also `never`, so no value could
  satisfy them. Named-tuple columns previously could not be inserted without a
  cast, and can now be written as objects:

  ```ts
  db.insert("packages").values({
    versions: [{ installed_version: "1.0.0", path: null }],
  });
  ```

  Object inference assumes the server serializes named tuples as JSON objects
  (`output_format_json_named_tuples_as_objects`, on by default). Connections that
  disable it, or that pin `compatibility` to a release predating the default,
  still receive arrays.

  Regenerating with the CLI is what surfaces the new record types; existing
  generated files keep their current shape until you re-run `hypequery generate`.

## 1.17.0

### Minor Changes

- 3ffcb21: Four CLI fixes found while setting up a Next.js project.

  **Reads `.env.local`.** The CLI loaded only `.env`, so a Next.js or Vite project
  with its ClickHouse credentials in `.env.local` — the convention those frameworks
  use, and the file the app itself reads — could not connect. Worse, the failure
  was reported as `Unable to detect database type. Re-run with --database`, which
  sends you after the wrong problem entirely. The CLI now reads the same cascade
  those frameworks do, most specific first: `.env.$NODE_ENV.local`, `.env.local`,
  `.env.$NODE_ENV`, `.env`. Earlier files win and real environment variables beat
  all of them, so existing `.env`-only setups are unaffected.

  **Reports the number of tables generated, not discovered.** `generate --tables
ontime` against a 79-table database printed `Found 79 tables` and `Generated
types for 79 tables` while correctly generating exactly one. The filter worked;
  the message made it look broken. The generator now reports the tables it actually
  wrote, so duplicate or nonexistent requested names cannot inflate the count. The
  command says `Found 79 tables, applying --tables filter` and `Generated types for
1 table`.

  **`generate:datasets` defaults to `analytics/datasets.ts`.** It previously wrote
  `src/datasets/generated.ts` while its sibling `generate` wrote
  `analytics/schema.ts`, splitting generated output across two trees. The new
  default matches the docs, matches `generate`, and matches `findDatasetsFile`,
  which already searched `analytics/datasets.ts` first. **This changes where the
  command writes when neither `--output` nor `--path` is given**; pass
  `--output src/datasets/generated.ts` to keep the old location.

  **The "Next steps" example matches the generated file.** It was hardcoded to
  `import { datasets } from './datasets/generated'` and `datasets.orders`,
  regardless of where the file went or which tables were in it. It now uses the
  real import path and the first real dataset name, so it can be pasted as-is.

## 1.16.4

### Patch Changes

- Updated dependencies [920878a]
- Updated dependencies [643abff]
  - @hypequery/protocol@0.11.0
  - @hypequery/deployment@0.7.3

## 1.16.3

### Patch Changes

- e370da0: Refresh every npm package page with a concise README and complete HypeQuery homepage and repository metadata.
- Updated dependencies [e370da0]
  - @hypequery/deployment@0.7.2
  - @hypequery/protocol@0.10.2

## 1.16.2

### Patch Changes

- 8f96a42: Add live source pull and diff commands plus restore-aware deployment drift protection.

## 1.16.1

### Patch Changes

- 6a95ba5: Capture the checked-out Git branch alongside commit and dirty state in deployment source snapshots. Cloud login no longer reads or sends Git branch context; project and environment remain the only deployment-target inputs.
- Updated dependencies [6a95ba5]
  - @hypequery/protocol@0.10.1
  - @hypequery/deployment@0.7.1

## 1.16.0

### Minor Changes

- 1fd0496: Allow Cloud login to select a stable deployment environment independently of Git branch context.

## 1.15.0

### Minor Changes

- 6c37151: Send the current Git branch during Cloud login so deployments receive a branch-scoped target. Opt out with `--no-branch` or `HYPEQUERY_CLI_SEND_BRANCH=0`. Login now also reports the project and environment Cloud issued the credential for.

## 1.14.1

### Patch Changes

- 225cba9: Allow trusted in-process hosts to provide an already-authenticated principal to
  Serve execution, and forward that principal through deployment runtime
  artifacts while retaining role, scope, and tenant enforcement.

  `api.execute()` (and `client()` / `run()`) now accept a `trustedAuth` option.
  Supplying it skips credential parsing only; required roles and scopes, tenant
  extraction, the context factory, validation, middleware, hooks, and
  `cache-control: no-store` all still apply. It is unreachable from the HTTP
  handler, so a network caller cannot set it. Pass `null` or omit it to fall
  through to the configured auth strategies.

  Because the principal is what authorization ran against, the pipeline now owns
  `ctx.auth` and `ctx.tenantId`. Two behavior changes follow:

  - A caller-supplied `context` containing `auth` or `tenantId` is rejected with a
    `VALIDATION_ERROR` instead of being merged over the authenticated principal.
  - A context factory returning `auth` no longer replaces the authenticated
    principal on `ctx.auth`.

  Deployment runtime artifacts refuse a `trustedAuth` argument when the bundled
  module exposes no Serve `execute()` pipeline, rather than running the handler
  with no enforcement.

## 1.14.0

### Minor Changes

- 24e0bd5: Capture, verify, upload, and receive multi-file project source snapshots with deployment bundles, including the API entrypoint and optional Git revision provenance.

### Patch Changes

- Updated dependencies [24e0bd5]
  - @hypequery/protocol@0.10.0
  - @hypequery/deployment@0.7.0

## 1.13.1

### Patch Changes

- 2616465: Fix two `hypequery init` defects found while regression-testing the interactive flow.

  **Ctrl+C now aborts.** `prompts.override({ onCancel })` was a no-op — `override` maps question _names_ to pre-supplied answers, not options — so an aborted prompt was indistinguishable from an unanswered one and each caller's `?? default` answered on the user's behalf. Pressing Ctrl+C at every prompt still scaffolded a full project and printed "Setup complete!". Prompts now receive a real `onCancel` handler that raises `PromptCancelledError`, which the CLI reports as `Cancelled.` and exits `130`.

  **chDB scaffolding works on the canary channel.** Canary builds pin siblings to `0.0.0-canary-*`, which cannot satisfy `chdb`'s `peerOptional @hypequery/clickhouse@">=2.1.2"`, so npm aborted the scaffold install with `ERESOLVE` and `hypequery init --database chdb` ended with "chdb is not installed". Canary installs on npm now pass `--legacy-peer-deps`; stable installs and other package managers are unchanged.

## 1.13.0

### Minor Changes

- 0e52fd9: Complete the interactive `init` path with database-driver and authentication
  choices, skip unused ClickHouse credential questions, and warn before
  scaffolding outside a directory containing `package.json`.

### Patch Changes

- f049012: Drop the `@hypequery/clickhouse` dependency from the CLI.

  `hypequery generate` reached into `@hypequery/clickhouse/cli` for the two
  functions it needed (`generateTypes`, `clickhouseToTsType`), which pulled the
  entire query builder — roughly 1.1 MB — into every CLI install. The generator
  now lives in the CLI itself, so `npx @hypequery/cli` installs neither the
  query builder nor its module graph.

  Nothing changes for users. The query builder is still what the scaffolder
  installs into _your_ project, and `@hypequery/clickhouse/cli` plus the
  `hypequery-generate-types` bin keep working exactly as before.

## 1.12.1

### Patch Changes

- e7a2ae8: Fix `ERR_MODULE_NOT_FOUND: Cannot find package '@hypequery/clickhouse'` on a clean install.

  `@hypequery/clickhouse` backs `hypequery init` and `hypequery generate`, but it was declared as an _optional_ peer dependency while being imported statically. Package managers skipped installing it (pnpm skips peers entirely; npm skips optional ones), so every command — including `hypequery --help` — crashed before running on a fresh `npx @hypequery/cli` install. It is now a regular dependency.

  Type generators are also loaded on demand, so a failure to resolve one no longer takes down unrelated commands.

## 1.12.0

### Minor Changes

- ec3cc55: Add a one-command deployment workflow that builds, prepares, and submits an API
  module, while exposing prebuilt uploads through `deployment:submit`.

  `hypequery deploy <api-module>` now orchestrates build → release → submission,
  and resolves the Cloud endpoint and token before building so a missing or
  expired login fails immediately instead of after a full bundle build.

  `hypequery deploy <bundle> --release <file>` still works but is deprecated and
  now prints a warning. Use `hypequery deployment:submit <bundle> --release
<file>` instead.

## 1.11.0

### Minor Changes

- e28bfed: Add browser-based Cloud login with PKCE, OS credential-vault storage, logout,
  and automatic authenticated deployment.

  `hypequery deploy` now also accepts an `http://127.0.0.1` or `http://localhost`
  submission endpoint for local Cloud development, warning that the token is sent
  in cleartext; all other endpoints still require HTTPS. `HYPEQUERY_API_TOKEN`
  must now be paired with `--endpoint` or `HYPEQUERY_DEPLOYMENT_ENDPOINT` — the
  CLI never combines one explicit value with the other from the stored login
  profile. A `HYPEQUERY_API_TOKEN` left in a project `.env` is picked up by this
  rule and must be unset to use `hypequery login`.

## 1.10.4

### Patch Changes

- e64edf3: Run bundled deployment queries through their Serve `execute` wrapper so
  runtime context factories and input/output validation remain active.

## 1.10.3

### Patch Changes

- Updated dependencies [ce908d8]
  - @hypequery/deployment@0.6.0

## 1.10.2

### Patch Changes

- 25adcdc: Remove the experimental local Studio flag, playground telemetry, and the optional
  Gateway dependency. `hypequery dev` continues to provide the development server,
  API documentation, OpenAPI contract, watch mode, and terminal execution logs.

## 1.10.1

### Patch Changes

- 4bff661: Clean up the experimental local gateway when dev-server startup fails.

## 1.10.0

### Minor Changes

- b775d7c: Add anonymous, opt-out usage telemetry to the experimental playground gateway. Telemetry is a no-op until an ingest endpoint is configured, prints a one-time disclosure on first enabled run, and never captures SQL, query names, inputs, results, or paths (machine UUID + hashed project id only; endpoint names hashed, durations bucketed). Opt out with `hypequery dev --no-telemetry`, `HYPEQUERY_TELEMETRY_DISABLED=1`, or `DO_NOT_TRACK=1`; it is also auto-disabled in CI.

## 1.9.5

### Patch Changes

- Updated dependencies [04abd3c]
  - @hypequery/protocol@0.9.0
  - @hypequery/deployment@0.5.1

## 1.9.4

### Patch Changes

- Updated dependencies [7097da6]
  - @hypequery/deployment@0.5.0
  - @hypequery/protocol@0.8.0

## 1.9.3

### Patch Changes

- Updated dependencies [9a8ac57]
  - @hypequery/deployment@0.4.0
  - @hypequery/protocol@0.7.0

## 1.9.2

### Patch Changes

- Updated dependencies [3de49ce]
- Updated dependencies [eb5faec]
- Updated dependencies [35af6f4]
  - @hypequery/deployment@0.3.0

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

# @hypequery/cli

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

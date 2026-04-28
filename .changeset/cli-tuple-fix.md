---
"@hypequery/cli": patch
---

Fix tuple type inference in generated types from the `hypequery generate` command to properly render positional tuple types instead of falling back to `string`. This includes:

- Added helper functions `splitTopLevelArgs`, `unwrapType`, and `getPrimitiveTsType` for better maintainability
- Added support for `Tuple(...)` types to render as positional TypeScript tuple types
- Added support for `LowCardinality` wrapper types
- Added support for nested tuple types within `Array`, `Map`, and `Nullable` wrappers
- Added test coverage for tuple type inference scenarios

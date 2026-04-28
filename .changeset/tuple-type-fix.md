---
"@hypequery/clickhouse": patch
---

Fix tuple type inference in generated types to properly render positional tuple types instead of falling back to `unknown`. This includes:

- Added `ParseTopLevelArgs` type helper to correctly parse comma-separated type arguments while preserving nested parentheses
- Updated `InferClickHouseType` to handle `Tuple(...)` types by inferring positional TypeScript tuple types
- Refactored CLI type-parsing logic to extract `clickhouseToTsType` into a separate module with improved tuple handling
- Added support for nested tuple types within `Array`, `Map`, and `Nullable` wrappers
- Added test coverage for tuple type inference scenarios

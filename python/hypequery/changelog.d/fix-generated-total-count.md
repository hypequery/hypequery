- Fix `hypequery init` and `hypequery generate datasets` emitting a SQL-backed
  `totalCount` measure without dependencies, which made every generated project fail
  to build a deployment contract and refused relationship joins. `totalCount` now
  counts the first non-nullable column (the first column if all are nullable), as the
  TypeScript generator does with its first column.

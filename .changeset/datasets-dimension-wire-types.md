---
"@hypequery/datasets": minor
"@hypequery/serve": minor
---

Type dimension values in dataset and metric result rows (`DatasetRow`, `DatasetRowFor`, `MetricRow`, `MetricRowFor`, and the results of `createDatasetClient(...).execute()`) as what queries actually return. Numeric dimensions are now `number | string | null`, because the built-in ClickHouse adapter returns `Int64`, `UInt64` and wider integers as JSON strings to keep their precision. Every dimension, and `period`, also includes `null`, because `Nullable` columns return SQL NULL. A new `DimensionResultValue<T>` type describes these values; `@hypequery/serve` re-exports it. `InferDimensionType` is unchanged and still describes a dimension's declared type.

This is a breaking type change. Code that read a numeric dimension as `number`, or any dimension or `period` without handling `null`, now fails to compile. Convert with `Number(value)` or `BigInt(value)` as needed, and check for `null`.

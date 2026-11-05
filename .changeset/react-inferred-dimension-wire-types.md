---
"@hypequery/react": minor
---

Type dataset and metric dimension values from `InferApiType` APIs as what serve actually returns. Numeric dimensions are now `number | string | null`, because the built-in ClickHouse adapter returns `Int64`, `UInt64` and wider integers as JSON strings to keep their precision. Every dimension, and `period`, also includes `null`, because `Nullable` columns return SQL NULL. Types from generated clients already followed these rules.

This is a breaking type change. Code that read a numeric dimension as `number`, or any dimension without handling `null`, now fails to compile. Convert with `Number(value)` or `BigInt(value)` as needed, and check for `null`.

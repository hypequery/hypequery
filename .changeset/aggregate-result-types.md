---
"@hypequery/clickhouse": minor
---

Aggregate result types now match what ClickHouse returns, instead of `string` for every aggregate:

- `sum()`: `number` for `Float*` and `Decimal` columns, `string` for integer columns (they widen to a quoted `Int64`), plus `| null` for `Nullable` columns. Over a subquery or CTE column known only as `number`, it is `number | string`.
- `avg()`, `stddev()`, `variance()`: `number | null`. NaN over too few rows arrives as `null`.
- `min()`, `max()`, `argMin()`, `argMax()`: the column's own type.
- `quantile()`: `number | null` for numeric columns, the column's type for dates.
- `count()`, `countDistinct()`, `approxCountDistinct()`: unchanged (`string`).

Code that converted results with `Number(...)` keeps compiling. Code that called string methods on, for example, a `Float64` sum now gets a type error where it used to fail at runtime.

Schemas can now declare `AggregateFunction(...)` and `SimpleAggregateFunction(fn, T)` columns, so a generated schema containing an AggregatingMergeTree table type-checks with `createQueryBuilder<IntrospectedSchema>()`. A `SimpleAggregateFunction(fn, T)` column has `T`'s type; an `AggregateFunction` column is an opaque state that you read with `mergeState()`.

GROUP BY inference no longer adds a selected expression that wraps an aggregate (`round(avg(x), 2)`) or a window function (`rank() OVER (ORDER BY sum(x))`), which ClickHouse rejected with "Aggregate function ... is found in GROUP BY".

The readonly error for the precision-safe 64-bit setting now names the fixes that keep precision: setting `output_format_json_quote_64bit_integers = 1` in the user's profile, or `readonly = 2`. `integerJsonEncoding: 'server-default'` is still offered as the fallback.

The legacy `hypequery-generate-types` generator types parameterized views, and types `SimpleAggregateFunction` columns by their value type, as `@hypequery/cli` now does.

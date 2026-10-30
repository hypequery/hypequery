---
'@hypequery/cli': patch
---

`generate:datasets` now maps ClickHouse column types by their exact outer type,
the same mapping Cloud uses, instead of by substring. Previously `Point`,
`Array(Int32)` and `Tuple(Float64, Float64)` became `dimension.number()` (with
sum/avg measures), and `Array(String)` and `Map(...)` became
`dimension.string()`, so the generated catalog advertised scalars that queries
then failed on. Each scalar element of a named `Tuple` now becomes its own
dimension through `tupleElement`, named `<column><Element>` (`pickupCity`).
Other composite columns (Array, Map, unnamed Tuple, geo, JSON) are left out
with a comment in the generated file. Only date/time-typed columns are picked
as `timeKey`, and `totalCount` counts a column that is actually a dimension.

Generated field names no longer clash. A field name is also its SQL alias,
and ClickHouse resolves an alias before a column of the same name, so a field
only takes a source column's name when it reads exactly that column. Otherwise
it takes a numeric suffix (`fareTotal2`), with a comment saying why: with
columns `fare_total` and `fareTotal`, the real `fareTotal` column keeps its
name. Measure names (`totalCount`, `totalX`, `avgX`) follow the same rule, so a
`count` column or a `fare`/`Fare` pair no longer produces duplicate keys.

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

Fields whose camelCased names clash (for example a `geo_country` column and the
`country` element of a `geo` tuple, or `fare_total` and `fareTotal`) no longer
produce duplicate object keys. Columns keep their natural name, a tuple element
or later column takes a numeric suffix (`geoCountry2`) with a comment saying
why, and generated measures reference the resolved field names.

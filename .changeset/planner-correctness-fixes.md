---
'@hypequery/datasets': patch
---

Three planner fixes that change results:

- Base dataset columns are always qualified with the dataset source, not only
  when a relationship join is present. ClickHouse resolves an output alias
  before a column of the same name, so a dimension `status` reading column
  `country` captured a filter or selection on the real `status` column (silent
  wrong rows), and a measure named like its column (`amount: measure.sum('amount')`)
  broke any other measure or filter on that column with `ILLEGAL_AGGREGATION`.
- Under a runtime scope of several tenants (`{ in: [...] }`) or all tenants
  (`{ scope: 'all' }`), relationship joins also match the tenant keys, so a key
  reused by another tenant no longer joins that tenant's row. `checkRelationships`
  counts (key, tenant) pairs under those scopes to match. Single-tenant SQL is
  unchanged.
- Formula `divide` casts the dividend to Float64. Decimal division kept the
  dividend's scale and truncated, so `round(divide(revenue, nullIfZero(orders)), 2)`
  could come out one cent low and a Decimal share such as 0.685 read 0.68.

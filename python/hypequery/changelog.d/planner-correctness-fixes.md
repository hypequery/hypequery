- Base dataset columns are always qualified (`__hq_base`), not only when a
  relationship join is present. ClickHouse resolves an output alias before a
  column of the same name, so a dimension `status` reading column `country`
  captured a filter or selection on the real `status` column (silent wrong
  rows), and a measure named like its column (`amount=measure.sum("amount")`)
  broke any other measure or filter on that column.
- Under `tenants(...)` with several tenants or `all_tenants()`, relationship
  joins also match the tenant keys, so a key reused by another tenant no longer
  joins that tenant's row. `check_relationships` counts (key, tenant) pairs
  under those scopes to match. Single-tenant SQL is unchanged.
- Formula `divide` casts the dividend to Float64. Decimal division kept the
  dividend's scale and truncated, so `round(divide("revenue",
  null_if_zero("orders")), 2)` could come out one cent low.
- `hypequery init --tenant-column` scaffolds answer their README's first query:
  the development token reads the tenant in `HYPEQUERY_DEV_TENANT` (added to
  `.env.example` and the README), and endpoints over tenant-scoped datasets use
  `EndpointPolicy(tenant="required")`, so a principal without a tenant gets a
  clear 403 and its client contract leaves them out.

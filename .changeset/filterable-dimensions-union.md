---
'@hypequery/datasets': minor
---

Declaring `filters` on a dataset no longer makes the rest of its dimensions
unfilterable. A dataset's filterable fields are now its declared filters plus
every dimension not marked `filterable: false` (RFC 0024). A dimension that no
declared filter is named after accepts the default operators, without null
checks, unless filters declared on it list operators, in which case it takes
theirs: declaring `plan_filter` on `plan` with `operators: ['eq']` also limits
`plan` to `eq`.

Relationship filters reach every filterable, non-SQL dimension of a
`belongsTo` or `hasOne` target. Rehydrated deployment contracts, whose filter
map lists only the declared filters, follow the same rule. Validation,
enforced constraints, `buildDatasetInputSchema` and the `DatasetFilterFor`
types all agree.

This widens what queries accept. To keep a dimension out of filters, mark it
`filterable: false`; an explicit empty `filters` map no longer disables
filtering. Published catalogs and contracts are unchanged.

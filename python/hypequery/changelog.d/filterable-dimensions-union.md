- Declaring `filters` on a dataset no longer makes its other dimensions
  unfilterable (RFC 0024), matching TypeScript. Callers may filter on every
  declared filter and every dimension not marked `filterable=False`. A
  dimension's own filter takes the operators of the filters declared on its
  field, so declaring `plan_filter` on `plan` with `operators=("eq",)` also
  limits `plan` to `eq`. Relationship filters reach every filterable, non-SQL
  dimension of a `belongs_to` or `has_one` target. An explicit empty
  `filters={}` no longer disables filtering; mark a dimension
  `filterable=False` to keep it out. Catalogs, client contracts and
  deployment contracts are unchanged.

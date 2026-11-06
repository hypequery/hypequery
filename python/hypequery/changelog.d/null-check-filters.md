- Null-check filters (RFC 0023): `filter.is_null(field)` and
  `filter.is_not_null(field)` render `IS NULL` / `IS NOT NULL` with nothing
  bound. Measures may use them in fixed `filters`; callers may use them only on
  filters whose `FilterDefinition(operators=...)` lists them, so the default
  operator list, and existing deployment identities, are unchanged. A null
  check carries no `value` (not even `null`); served requests and the cache
  and deployment wire omit it. Exported `SEMANTIC_NULL_CHECK_OPERATORS`.

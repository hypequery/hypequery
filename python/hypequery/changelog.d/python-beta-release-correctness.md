- Serialize relationship-qualified measures as strings (preserving NULL), like
  local measures, without changing dimension values or native client results.
- Allow `X-Include-Meta` in the default CORS request-header policy so React
  infinite dataset and metric queries can request pagination across origins.
- Stop suggesting `totalCount` for tables with no supported non-nullable column.
  Generate `nonNullCount` with an explicit warning instead, and use it in the
  scaffold example. It counts non-null values, not every row. Review existing
  `totalCount` references when regenerating definitions for these tables.

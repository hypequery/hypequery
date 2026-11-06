- Segments (RFC 0015): `dataset(segments={"paid": segment(filter.eq("status", "paid"))})`
  declares named row filters that queries select by name,
  `DatasetQuery(segments=("paid",))` or `"segments": ["paid"]` in a served
  request. A segment may use any of the dataset's own dimensions, including
  ones not exposed as filters, but not a relationship or the tenant column, and
  may use null checks. Catalogs and contracts list each segment's label and
  description only. Publishing is refused until deployment contract 3, as in
  TypeScript.

- Resolved-row sources (RFC 0021): `dataset(..., row_resolution=...)` reads a
  ReplacingMergeTree or CollapsingMergeTree source with `FINAL`, so superseded
  row versions never double count. `resolved_rows.replacing(deleted_column=...)`
  also keeps only rows not soft-deleted, and `resolved_rows.collapsing(sign_column=...)`
  / `.versioned_collapsing(...)` only surviving positive rows; `resolved_rows.final()`
  is `FINAL` alone. Relationship targets are resolved inside their join, and
  relationship key checks count current rows. Every statement that reads a
  resolved source pins `optimize_move_to_prewhere_if_final = 0`, so no filter
  can match an older version. Catalogs, semantic contracts and deployment
  contracts carry `rowResolution`, as TypeScript does.

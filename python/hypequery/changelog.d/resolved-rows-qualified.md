- Joins and relationship key checks over a resolved (`FINAL`) target qualify
  its current-row column, so a deleted or sign column named like an internal
  alias (`_hq_match`, `__hq_rows`, `__hq_keys`) no longer reads that alias.

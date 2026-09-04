---
"@hypequery/datasets": minor
---

Enforce `groupable: false` in generated query schemas. A dimension declared
non-groupable — typically one that exists only to back a measure — is no longer
accepted as a `dimensions` or `orderBy` selection by `query_dataset` or
`query_metric`. It previously passed schema validation even though the
agent-safe catalog hid it, so a dataset advertised one set of dimensions and
accepted another.

Filterability is unaffected: a dimension that is filterable but not groupable
remains usable as a filter field.

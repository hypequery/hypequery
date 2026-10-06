---
"@hypequery/datasets": patch
---

`dataset()` now validates filter definitions before any query can use them.
A measure filter's `field` must be a declared dimension or filter, or a safe
column identifier (optionally `<relationship>.<field>`), and a declared filter's
`field` must be a declared dimension or a safe column identifier. Unsupported
operators are rejected in both places. Previously these values were rendered
into SQL unchecked. Definitions that put SQL text in a filter `field` now fail at
construction: declare a dimension with `sql` and filter on that dimension.

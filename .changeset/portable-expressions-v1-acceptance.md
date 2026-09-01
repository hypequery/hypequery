---
"@hypequery/protocol": minor
"@hypequery/protocol-conformance": minor
---

Accept RFC 0003 and freeze portable dataset expression extension version 1.

The accepted text specifies expression depth and node accounting, independent
collection limits, predicate-only aggregate and query filters, exact query
identifier shapes, safe-integer pagination, deterministic validation order,
and immutable detached validation results.

The shared `expressions-v1` corpus now pins both sides of every protocol limit:
depth 16/17, 1,000/1,001 expression nodes, and 100/101 collection items. It
also covers both valid `round` arities, empty aggregate filters, the safe
integer maximum, invalid aggregate option combinations, non-predicate filters,
metric-query field exclusion, and invalid pagination and ordering values.

The conformance reference adapter now materializes deterministic generators for
success cases as well as rejection cases, allowing large exact-boundary inputs
to remain compact in the portable corpus.

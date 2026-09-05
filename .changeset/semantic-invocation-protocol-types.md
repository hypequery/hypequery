---
"@hypequery/protocol": minor
"@hypequery/protocol-conformance": patch
---

Add portable semantic invocation records (RFC 0014): the dataset/metric
invocation request, its result, and a closed failure record, with validators,
limits, and stable `HQ_INVOCATION_*` codes.

Identifiers are normalized into `operation` rather than duplicated beside it, so
a request cannot name two different datasets. There is no tenant field: a caller
cannot supply or change a tenant. The failure record has no field that accepts
SQL, parameter values, tenant identifiers, physical source details, or a
provider exception, and adds the `unsupported-capability` category decision 0005
requires.

These are types and validation only — no data-plane or runtime execution.

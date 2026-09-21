---
"@hypequery/protocol": minor
"@hypequery/protocol-conformance": minor
---

Accept RFC 0006 and freeze deployment contract version 2.

The accepted text states the rules both implementations already enforce but
the Proposed text left implicit: relationship `queryable` must agree with the
relationship kind, targets must resolve within the contract, sensitivity comes
from a closed set, a currency is three uppercase ASCII letters, an endpoint
path is absolute, and tenant `auto-inject` declares its column.

It adds three sections. Absent, empty, and null: an optional field is absent or
valid, never `null` — stated because the distinction is invisible in languages
without `undefined`. Derived measures: aliases map to base measures in the same
dataset and the formula references exactly those aliases, over a closed
arithmetic grammar, with names unique across base and derived together.
Embedded SQL expressions: a malformed RFC 0005 envelope keeps its own
`HQ_QUERY_IMPLEMENTATION_*` codes rather than being flattened into a deployment
code.

The shared `deployments-v2` corpus gains a rejection file — 26 cases covering
each of those rules. The family previously had one success and one identity
case, which cannot distinguish a faithful validator from one that accepts
contracts another implementation rejects.

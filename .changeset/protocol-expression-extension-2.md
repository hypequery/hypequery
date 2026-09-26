---
'@hypequery/protocol': minor
'@hypequery/protocol-conformance': minor
---

Add expression extension 2 (RFC 0015) validation. Pass `{ extension: 2 }` to `validateProtocolExpression` or `validateProtocolSemanticQuery` to accept `minute`/`hour` grains, the `approxCountDistinct` aggregation, query `segments`, and one-hop relationship-qualified `measures`. Extension 1 remains the default and is unchanged. The conformance corpus gains the `expressions-v2` family, which the reference adapter announces.

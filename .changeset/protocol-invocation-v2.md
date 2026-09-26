---
'@hypequery/protocol': minor
'@hypequery/protocol-conformance': minor
---

Add semantic invocation 2 (RFC 0015) through `validateProtocolSemanticInvocationV2`. It is identical to version 1, except that the operation is validated under expression extension 2. Under the lowest-version rule, a version 2 request that uses no segment, sub-day grain, or relationship measure is rejected. `validateProtocolSemanticInvocation` remains version 1 only. The conformance corpus gains the `semantic-invocations-v2` family.

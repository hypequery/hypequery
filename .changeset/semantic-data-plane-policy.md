---
"@hypequery/deployment": minor
---

Add `createDeploymentSemanticDataPlane()`, semantic invocation beside
named-query execution. A dataset or metric call now runs the same enforcement
sequence a named query does: select the active generation, resolve the target
and its endpoint policy from the validated contract, authenticate, enforce roles
and scopes, resolve tenant, apply the most restrictive budget, validate the
operation, execute, then validate the result.

Execution is injected — this decides whether a call is allowed and what it may
ask for, not how it runs. The bounds it computed are enforced against what the
executor returned, so an executor cannot widen them: a result over the effective
row or response-byte budget, one carrying more rows than the caller's own
`limit` asked for, or one serving a different activation than the one selected,
is refused rather than returned. Failures carry the portable
`ProtocolSemanticInvocationFailure` categories, and
`toProtocolSemanticInvocationFailure()` projects one onto the closed record
without unwrapping a cause into it.

Operation validation is contract-driven, so a gateway can reject a bad
invocation without loading any of the deploying application's code:
non-groupable dimensions, undeclared measures, filters outside a field's
declared operator list, filters whose compared value is anything but a literal,
unsupported grains, over-budget limits, and relationship paths deeper than one
hop are all refused. Checking both operands of a comparison matters twice over:
a right-hand reference addresses a field this layer never matched against the
contract, and leaving it to the executor reports a caller's mistake as a
deployment capability gap. A joined field carries
its target's `groupable` and `filterable` flags separately, so a relationship
neither hides a filterable field that cannot be grouped nor exposes one the
target declared unfilterable.

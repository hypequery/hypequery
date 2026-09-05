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
ask for, not how it runs. Failures carry the portable
`ProtocolSemanticInvocationFailure` categories, and
`toProtocolSemanticInvocationFailure()` projects one onto the closed record
without unwrapping a cause into it.

Operation validation is contract-driven, so a gateway can reject a bad
invocation without loading any of the deploying application's code:
non-groupable dimensions, undeclared measures, filters outside a field's
declared operator list, unsupported grains, over-budget limits, and
relationship paths deeper than one hop are all refused.

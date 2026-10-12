---
"@hypequery/protocol": minor
---

Add `checkProtocolDeploymentContract`, `checkProtocolDeploymentContractV3` and `checkProtocolDatasetContract`, which report every failure in a contract in one pass (bounded at 100) instead of throwing the first. They accept exactly what the matching `validate*` functions accept and skip checks that depend on a part that already failed, so a mistake is not reported twice.

A malformed SQL expression embedded in a deployment contract still fails with its `HQ_QUERY_IMPLEMENTATION_*` code, but its `path` now locates it in the contract (for example `$.datasets[0].dimensions[1].source.sql`) instead of the expression root (`$.sql`).

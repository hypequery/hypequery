---
'@hypequery/protocol': minor
---

RFC 0030 version-neutral readers and deployment-target acceptance.

- Readers that take a contract 2 or contract 3 dataset: `datasetAllowedFilters` (`filters` or `allowedFilters`), `withDatasetAllowedFilters`, `datasetSegments`, `datasetTimeAxes` (`timeField`, then `alternateTimeFields`) and `datasetGrains`. They also accept an RFC 0006 dataset contract.
- Invocation selection: `semanticInvocationVersion(operation)` returns 1 or 2 under the lowest-version rule (the logic `validateProtocolSemanticInvocationV2` used privately), `semanticInvocation2Features(operation)` names what forced 2, and `toSemanticInvocation(operation, { target, … })` wraps an operation in a validated invocation at that version.
- Target acceptance: `datasetContract3Features`, `deploymentContract3Features`, `PROTOCOL_CONTRACT_3_FEATURES` and `PROTOCOL_CONTRACT_3_FEATURE_LABELS` name what forces contract 3, from the contract alone. `validateProtocolDeploymentTargetAccepts` parses a target's `accepts` advertisement, with `DEFAULT_PROTOCOL_DEPLOYMENT_TARGET_ACCEPTS` (`deploymentContract: [2]`, `semanticInvocation: [1]`, `bundle: [1, 2]`) for anything absent. `checkProtocolDeploymentTargetAcceptance` reports a contract or bundle version the target refuses, with the datasets and features that forced it.
- The contract 3 validator's lowest-version check now uses the same feature registry. Behaviour is unchanged.

Consumer-breaking: no. Every export is new; no existing type, export or behaviour changes.

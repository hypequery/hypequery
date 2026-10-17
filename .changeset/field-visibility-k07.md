---
"@hypequery/protocol": minor
"@hypequery/deployment": minor
---

Add field visibility and enforced constraints (RFC 0018). `@hypequery/protocol` exports `validateProtocolFieldVisibility` and `resolveProtocolVisibleDatasetFields`. The semantic data plane accepts `resolveFieldVisibility` and `resolveConstraints`: hidden datasets and fields are refused exactly like unknown ones (before access and tenant checks), joins over hidden keys are hidden, and provider-enforced comparisons are ANDed onto every call within the dataset's filter ceiling. `DeploymentSemanticContextInput` names the input every context resolver receives. `projectAuthorizedDeploymentContract` takes a `visibility` option so discovery advertises only what execution accepts.

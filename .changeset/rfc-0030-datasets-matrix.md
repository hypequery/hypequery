---
'@hypequery/datasets': minor
---

`DATASET_EXECUTION_CAPABILITIES` no longer claims what hypequery Cloud accepts (RFC 0030). Each feature's `cloud` flag, which always meant Core's portable runtime, is now `portable`. `cloud` stays as a deprecated alias of it, and `cloudDeploymentVersion` stays deprecated at its last value until a major release. A deployment target advertises the versions it accepts, and `hypequery deploy` checks them. The catalog projection and contract rehydration read filters, segments and time keys through `@hypequery/protocol`'s version-neutral readers. Behaviour is unchanged.

Consumer-breaking: code that builds its own `DatasetFeatureSupport` objects must add `portable`.

---
'@hypequery/protocol': minor
'@hypequery/datasets': minor
'@hypequery/deployment': minor
'@hypequery/cli': patch
---

Publish and run deployment contract 3 (RFC 0015): segments, window and shift measures, `approxCountDistinct`, and sub-day grains (K-01).

- `@hypequery/datasets`: `publishToCloud` and `buildProtocolDeploymentContract` emit contract 3 when a dataset uses segments, a window or shift measure, `approxCountDistinct`, or a `minute`/`hour` default grain, and contract 2 otherwise, so existing deployments keep their identity. Their return type is now `ProtocolDeploymentContractAnyVersion`. `rehydrateProtocolDeploymentContract` and the portable runtime read both versions and rebuild each feature to the SQL the authored dataset compiles. Query `segments` now reach the planner, and `between` filters arriving from the data plane are decoded. Published datasets accept every grain from `minute` to `year`. Because no contract carries a `timeGrains` restriction, a dataset that sets one must list all seven grains to publish. `buildClientContract` refuses a contract 3 deployment by name. A segment predicate that is not an `and` of comparisons is refused with `HQ_PORTABLE_SEGMENT_PREDICATE_NOT_CONJUNCTION`. `DATASET_EXECUTION_CAPABILITIES` reports TS and Python publishing and Cloud execution for all five features, and `cloudDeploymentVersion` is now 3.
- `@hypequery/protocol`: `validateProtocolDeploymentContractAnyVersion`, `prepareProtocolDeploymentContractAnyVersion` (each version keeps its own identity domain), `validateProtocolDeploymentContractAtLowestVersion` (lowers a contract 3 with no contract 3 feature to contract 2), and the `ProtocolDeploymentContractAnyVersion` / `ProtocolDeploymentDatasetAnyVersion` types. Field visibility reads `allowedFilters` and reports the `segments` whose predicate reads only visible dimensions.
- `@hypequery/deployment`: the semantic data plane accepts contract 2 or 3 and semantic invocations 1 or 2, and validates `segments` against the dataset, refusing a hidden segment exactly as it refuses an unknown one. Bundle verification and intake accept contract 3 bundles. `projectAuthorizedDeploymentContract` narrows contract 3 and lowers the result to contract 2 when nothing contract 3 remains visible.
- `@hypequery/cli`: `hypequery deploy` and deployment validation accept contract 3. `onboard check` refuses one by name.

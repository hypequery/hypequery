---
"@hypequery/datasets": minor
---

Add `rehydrateProtocolDatasets()`, which rebuilds executable datasets from a
validated deployment contract — the inverse of `buildProtocolDatasetContract`.
This is what makes decision 0005's portable native execution possible: a runtime
resolves a dataset from the active contract and plans with the existing semantic
planner, loading no customer module.

Rehydration routes through the public `dataset()` factory, so a rebuilt dataset
is constructed by the same code path as an authored one. Contract → catalog →
contract is an identity, and a rebuilt registry projects the same agent-safe
catalog as the contract it came from.

A rebuilt metric is pinned to the dimensions, filters, and grains the contract
declared rather than re-deriving them from the dataset, so rehydration cannot
widen what a deployment published. Anything portable execution cannot rebuild —
a derived metric, whose symbolic expression contract v1 does not carry — throws
`UnsupportedContractFeatureError` instead of executing an approximation.

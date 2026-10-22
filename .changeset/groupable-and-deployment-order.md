---
'@hypequery/datasets': patch
---

Two parity fixes with the Python SDK:

- A dimension declared `groupable: false` is now refused as a query dimension, locally and through a relationship (`Dimension "x" is not groupable.`). It can still be filtered on. Serve's input schemas already excluded these dimensions; direct client queries didn't.
- `buildProtocolDeploymentContract` lists datasets by name, so the deployment contract and its identity no longer depend on the order the datasets are passed in. A deployment whose datasets weren't already in name order gets a new, stable identity once.
- Protocol artifacts now order names with a fixed collation (underscore, digits, then letters without case, lowercase first) instead of the host's `localeCompare`, matching Python's `portable_name_key`. Contracts and their identities no longer change with the machine's locale; under the default locale the order is unchanged.

---
'@hypequery/datasets': patch
---

Two parity fixes with the Python SDK:

- A dimension declared `groupable: false` is now refused as a query dimension, locally and through a relationship (`Dimension "x" is not groupable.`). It can still be filtered on. Serve's input schemas already excluded these dimensions; direct client queries didn't.
- `buildProtocolDeploymentContract` lists datasets by name, so the deployment contract and its identity no longer depend on the order the datasets are passed in. A deployment whose datasets weren't already in name order gets a new, stable identity once.

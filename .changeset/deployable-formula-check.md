---
'@hypequery/datasets': minor
---

Add `assertDeployable(dataset)`, which refuses derived measures the deployment contract cannot carry (a reference to another derived measure, or a literal anywhere other than `round` decimals or a `coalesce` fallback) with an error naming the dataset and measure, for example `orders.doubled: a numeric literal cannot be an arithmetic operand in a deployable formula`. `buildProtocolDeploymentContract`, and so `hypequery deploy`, runs the check before building the contract instead of failing later with only a contract path such as `$.datasets[2].measures[19].expression.right`.

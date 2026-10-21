---
'@hypequery/datasets': patch
---

Refuse number filter values that aren't safe integers (beyond ±2^53). Number filters bind as Float64, so such a value is already rounded and silently matched nothing against an exact `Int64` or `UInt64` id. Declare a large id as `dimension.string()` to filter it exactly.

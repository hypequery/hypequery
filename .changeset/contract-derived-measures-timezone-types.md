---
'@hypequery/serve': patch
'@hypequery/datasets': patch
---

`GET /contract` now includes each dataset's `derivedMeasures` (label, description, `uses`, `expression`, time-range and grain metadata). Declaring `timezone` on a dimension or measure is now a compile-time error instead of only throwing when the dataset loads; set it on `createDatasetClient` or the query.

---
'@hypequery/datasets': patch
---

Quote every alias the datasets planner generates — dimension, `period`, measure and metric aliases, and the GROUP BY, ORDER BY and outer-query references to them — so names that are SQL keywords (`rows`, `order`, `end`, `window`, …) work and engines that fold unquoted case keep the semantic name. `compileDataset()` and `toSQL()` show the backtick-quoted aliases; result row keys are unchanged. Custom `QueryBuilderLike` implementations receive these aliases already quoted and must insert them verbatim.

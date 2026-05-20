---
'@hypequery/clickhouse': patch
---

Fix aggregation `GROUP BY` inference when chaining aggregate helpers without an explicit grouping dimension. Aggregate aliases such as `revenue` from `SUM(price) AS revenue` are no longer reused as inferred `GROUP BY` keys, which avoids invalid SQL like `GROUP BY revenue` when additional aggregations are appended.

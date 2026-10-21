---
'@hypequery/datasets': patch
---

Preserve NULLs for unmatched related dimensions and related-dimension filters independently of ClickHouse `join_use_nulls`, including queries that select no related measure. Every relationship join now projects the target with a `_hq_match` marker, and a joined dimension such as `customer.tier` renders as `if(isNotNull(customer._hq_match), customer.tier, NULL)` in SELECT, GROUP BY, ORDER BY, WHERE and measure filters. An order whose customer is missing or belongs to another tenant groups under `NULL` instead of `''`/`0`, and a `neq` filter on a joined dimension excludes it, matching the Python package and standard SQL semantics.

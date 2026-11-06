---
"@hypequery/datasets": patch
---

A relationship join to a resolved (`FINAL`) target whose deleted column is named `_hq_match` no longer drops every target row: the join's match marker now avoids the current-row column's name.

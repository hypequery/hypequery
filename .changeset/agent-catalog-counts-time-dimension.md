---
"@hypequery/datasets": patch
"@hypequery/mcp": patch
---

`get_dataset_schema` names the time dimension when the dataset's `timeKey` is a column that a dimension reads under another name (`timeKey: 'occurred_at'` with `occurredAt: dimension.timestamp({ column: 'occurred_at' })`); it was `null`. `list_datasets` counts dimensions, measures and metrics from the same projection `get_dataset_schema` returns, so derived measures are counted and the two tools agree.

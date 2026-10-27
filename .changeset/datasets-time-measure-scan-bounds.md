---
"@hypequery/datasets": patch
---

Time-measure queries (trailing, toDate, cumulative, shift and formulas over them) no longer scan a dataset's whole history. The source scan is bounded to the requested range, widened by every lookback the query needs and a timezone margin, with no lower bound for cumulative measures. Exact filtering is unchanged, so results are identical. On Postgres the bound uses a time-key index.

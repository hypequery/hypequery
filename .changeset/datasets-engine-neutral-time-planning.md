---
"@hypequery/datasets": patch
---

Plan time measures through engine-neutral SQL rules, so a datasets engine other than ClickHouse can run trailing, toDate, cumulative and shift measures. ClickHouse SQL is unchanged.

Time filters can compare the bare time-key column with converted values on engines that support it, so an index on the time key applies. Physical column references go through the engine's quoting rules.

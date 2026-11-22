---
"@hypequery/protocol": minor
"@hypequery/datasets": minor
"@hypequery/deployment": minor
"@hypequery/protocol-conformance": patch
---

Publish and select alternate time keys (RFC 0029). A dataset's `timeKeys` no longer disappear without a word at publish time: they become contract 3 `alternateTimeFields`, which makes such a deployment contract 3 under the lowest-version rule, and rehydrate back to `timeKeys`. Portable semantic queries (dataset and metric) gain `timeKey`. The deployment data plane checks it against `timeField` and the visible alternates, and puts `inDateRange`, `fill` and window/shift ranges on the selected axis. Visibility projections drop hidden alternates. Cache preimages refuse a query that names a `timeKey`.

---
'@hypequery/protocol': minor
'@hypequery/datasets': minor
---

Add `rowResolution` to the deployment contract (RFC 0021) so versioned ClickHouse
sources can be published. A dataset declaring it is read through the `final: true`
source path, with `FINAL` in place and only current rows kept: the deletion column
equal to zero (ReplacingMergeTree) or the sign column equal to one (collapsing
engines), on base reads and on relationship targets. Deployment contracts preserve
the policy on validation, hashing and rehydration. Publishing `final: true` without
`rowResolution` is refused, because the contract needs the engine.

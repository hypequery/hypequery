---
"@hypequery/protocol": minor
"@hypequery/datasets": minor
"@hypequery/deployment": minor
"@hypequery/protocol-conformance": patch
---

Relative date ranges and filled series (RFC 0029).

- `inDateRange` filters a time axis by a relative range: `today`, `yesterday`, `this|last week|month|quarter|year`, `last N days|weeks|…`, `month|quarter|year to date`. The dataset client resolves it once per query, in the query timezone, to a half-open `gte`/`lt` range. `last N` excludes the current period and `this` includes it. `createDatasetClient({ now })` and `createPortableSemanticExecutor({ now })` pin the clock. The protocol accepts the operator only in semantic-query filters.
- `fill: true` on a `by` query returns every period of its bounded time range, using the window-measure series (count measures 0, others null). It is refused without a top-level range, without `by`, and with `having`.
- The deployment data plane checks both against the contract (`inDateRange` only on the time field, with `gte`/`lt` allowed; `fill` needs one top-level bounded range). It also refuses window and shift queries without that range as `input-invalid`. Cache preimages refuse relative ranges and `fill: true`.

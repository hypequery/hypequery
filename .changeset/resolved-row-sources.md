---
'@hypequery/protocol': minor
'@hypequery/datasets': minor
---

Add `rowResolution` (RFC 0021), the one API for reading versioned ClickHouse
sources, in code and in the deployment contract, so they can be published.
`{ kind: 'final' }` reads the source with `FINAL`; naming the engine
(`replacing` with `deletedColumn`, `collapsing`/`versioned-collapsing` with
`signColumn`) also keeps only current rows, on base reads and relationship targets.
Deployment contracts preserve the policy on validation, hashing and rehydration,
so a published dataset reads exactly as it does locally.

`final: true` is deprecated: it still works, is read as `rowResolution:
{ kind: 'final' }`, and logs a one-time warning. Its result-cache keys change once,
because they are now built from `rowResolution`.

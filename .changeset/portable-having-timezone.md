---
'@hypequery/protocol': minor
'@hypequery/deployment': minor
'@hypequery/datasets': patch
---

Portable semantic queries accept `having` and `timezone` (RFC 0025), so a host running through the semantic data plane can execute what the MCP `query_dataset` tool and client contracts already advertise.

- `@hypequery/protocol`: `validateProtocolSemanticQuery` accepts `having` (dataset queries; each condition names a selected measure, with a numeric comparison) and `timezone` (RFC 0018's pinned registry) under extensions 1 and 2. New `ProtocolHavingCondition` and `ProtocolHavingComparisonOperator` types. Cache preimages refuse a non-empty `having` or a non-UTC `timezone` rather than leave them out of the key; `"UTC"` normalizes as if absent, so no existing preimage changes.
- `@hypequery/deployment`: the semantic data plane counts `having` conditions against `maxFilters` together with filters and enforced constraints, refuses a `timezone` on a dataset with no visible time field, and refuses `having` on a hidden measure exactly as it refuses selecting one.
- `@hypequery/datasets`: the portable executor passes `having` and `timezone` to the dataset client.

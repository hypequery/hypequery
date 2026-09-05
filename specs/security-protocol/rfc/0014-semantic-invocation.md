# RFC 0014: Semantic invocation

- Status: Proposed
- Version: semantic invocation 1

## Summary

This RFC defines the portable request, result, and failure records for invoking
a dataset or metric against an activated deployment. It binds the RFC 0003
semantic query and the RFC 0008 release target into one closed envelope so a
gateway in any language can express a semantic call without importing the
deploying application's source.

These records carry no execution. They describe what was asked, what came back,
and how it failed. Deployment decision 0002 defines the enforcement sequence
that consumes them.

## Invocation

An invocation has `kind: "hypequery-semantic-invocation"`, `version: 1`, a
release `target`, and one `operation`. It may also carry an
`activationRevision`, a `budget`, and a `correlationId`. Unknown fields fail
closed.

`operation` is an RFC 0003 semantic query, discriminated by its own `kind` as
`dataset` or `metric`. Decision 0002 sketched the dataset and metric names
beside the nested query; that placement is rejected here because the two copies
can disagree and the record would not be unambiguous. The decision explicitly
permits normalizing to one identifier location, so the names live only inside
`operation`.

There is no tenant field, and one MUST NOT be added. A caller cannot supply or
change a tenant: it is resolved by the deployment's provider callback inside
trusted execution context. A record that carried a caller tenant would make the
central guarantee of decision 0002 unverifiable from the wire format alone.

`activationRevision` pins the call to one activation. It is a lowercase
SHA-256 identity. When present, a runtime MUST reject the call with the
`stale-activation` category if that revision is no longer active, rather than
silently executing against a newer generation.

`budget` carries caller-requested ceilings: `deadlineMs`, `maxRows`, and
`maxResponseBytes`. A runtime applies the most restrictive of the caller
budget, the endpoint policy, and its own defaults, so a caller can tighten a
budget but never widen one. An empty `budget` object is rejected: it is
indistinguishable in effect from omitting the field, and two encodings of one
request are not portable.

## Result

A result has `kind: "hypequery-semantic-invocation-result"`, `version: 1`, the
`activationRevision` that actually served the call, `data`, and `meta`.

`data` is an array of rows. A row is a flat object whose values are string,
finite number, boolean, or null. Richer values would require the RFC 0001
tagged value model; result rows deliberately stay scalar so a consumer never has
to interpret a tagged envelope to read a cell.

`meta.rowCount` MUST equal the length of `data`. A count that disagrees with the
rows it describes is a broken result rather than a hint, because a consumer
would page or aggregate on a false total. `meta.pagination`, when present,
carries `limit`, `offset`, and `hasMore`.

Operational metadata — trace identity, timing, cache outcome, deployment
identity, tool-manifest identity — is not part of this record. It belongs in the
transport's own metadata rather than beside rows presented to a model.

## Failure

A failure has `kind: "hypequery-semantic-invocation-failure"`, `version: 1`, a
`category`, a stable `code`, a safe `message`, `retryable`, and `relist`. It may
carry a bounded input `path` and the serving `activationRevision`.

The categories are the decision 0002 minimum set plus one addition:

| Category | Meaning |
| --- | --- |
| `configuration-invalid` | Configuration invalid or unavailable |
| `not-found` | Target, dataset, or metric not found |
| `unauthenticated` | Credentials absent or unusable |
| `forbidden` | Authenticated but not permitted |
| `tenant-required` | A required tenant could not be resolved |
| `input-invalid` | Semantic input rejected |
| `budget-exceeded` | A deadline, row, or byte ceiling was hit |
| `cancelled` | The caller aborted the call |
| `stale-activation` | The pinned activation is no longer active |
| `unsupported-capability` | Portable execution cannot reproduce this target exactly |
| `executor-unavailable` | The executor could not be reached |
| `executor-failed` | The executor failed |
| `output-invalid` | The executor returned an invalid result |

`unsupported-capability` is required by decision 0005: a surface the SQL
equality harness cannot make byte-identical, and a derived metric before its
symbolic expression is carried, MUST be rejected with this category rather than
executed with different semantics.

The record is closed by construction. There is no field that accepts SQL,
parameter values, tenant identifiers, physical source or column names, stack
traces, or a provider exception. `code` is restricted to an uppercase
`[A-Z][A-Z0-9_]*` token so a provider string cannot be passed through as one.

## Limits

| Limit | Maximum |
| --- | ---: |
| Project, environment, correlation ID, code, or path UTF-8 bytes | 1,024 |
| Failure message UTF-8 bytes | 1,024 |
| Result rows | 10,000 |
| Columns per row | 256 |
| Cell UTF-8 bytes | 65,536 |
| Requested deadline (ms) | 3,600,000 |
| Requested response bytes | 33,554,432 |

Products may lower but not raise these limits while claiming semantic
invocation version 1 conformance.

## Stable failure codes

These are validation failures of the records themselves, distinct from the
`category` an executed invocation reports.

- `HQ_INVOCATION_TYPE`
- `HQ_INVOCATION_UNKNOWN_FIELD`
- `HQ_INVOCATION_INVALID_VERSION`
- `HQ_INVOCATION_INVALID_VALUE`
- `HQ_INVOCATION_TOO_MANY_ITEMS`
- `HQ_INVOCATION_TOO_LARGE`
- `HQ_INVOCATION_UNSAFE_OBJECT`

## Security

Objects with custom prototypes, accessors, symbols, hidden properties, sparse
arrays, or extra array properties are rejected. Strings carrying control
characters are rejected. Non-finite numbers are rejected because they have no
portable JSON encoding. The validator returns a detached, deeply immutable
snapshot, so a caller cannot mutate a record after it has been validated.

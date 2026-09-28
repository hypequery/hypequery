# RFC 0016: Cache preimage for semantic queries

- Status: Proposed
- Created: 2026-09-28
- Version: cache preimage 1
- Depends on: RFC 0001, RFC 0003, RFC 0009, RFC 0013, RFC 0015
- Draft fixtures: `specs/security-protocol/drafts/cache-preimages-v1/`

## Summary

RFC 0013 turns a canonical preimage into an opaque store key, and leaves the
preimage's contents to "the containing query contract". This RFC is that
contract for dataset and metric queries. It fixes exactly which facts identify
a cached result and how each one is written, so two runtimes in any language
build the same bytes for the same request, and different bytes whenever the
rows could differ.

## Motivation

A preimage can be wrong in three ways, and each has a different cost:

- **Missing a fact that changes rows** makes the cache serve wrong data. If
  tenant scope is left out, one tenant's rows are served to another. This is
  the RFC 0009 "cache confusion" threat.
- **Including a fact that does not change rows** makes the cache never hit.
  Per-call identifiers such as `correlationId` are examples.
- **Encoding the same fact two ways** splits entries between equivalent
  requests, and across languages it means TypeScript and Python never share
  entries.

The TypeScript `query-signature.ts` is a readable signature built for one
runtime. It is not a protocol artifact, and it records the raw tenant value in
what becomes the store key. This RFC replaces it as the input to RFC 0013.

## Inputs

A runtime builds the preimage from four inputs. It obtains all of them
server-side, after authentication and tenant resolution, and none of them from
request fields other than the semantic query itself.

| Input | Source |
| --- | --- |
| `query` | The RFC 0003 semantic query, validated under expression extension 2 (RFC 0015) |
| `definitionIdentity` | Identity of the definitions that execute the query (see below) |
| `tenant` | The tenant capability present on the execution (RFC 0009) |
| `rowLimit` | The effective maximum row count the runtime will return |

### Definition identity

`definitionIdentity` is 64 lowercase hexadecimal characters. It MUST change
whenever anything that affects result rows changes, including dimension and
measure SQL, sources, joins, segments, tenant keys, and dataset limits.

For a released deployment it MUST be the RFC 0007 bundle identity. A runtime
executing local definitions without a bundle MAY use its own digest over the
definitions it executes. Local and released entries are then never shared,
which is correct: they are not guaranteed to run the same SQL.

### Tenant

`tenant` records the capability present on the execution, whether or not the
target dataset applies a tenant predicate. This is the RFC 0009 rule: once a
capability is present, the response is tenant-aware and never shares a key
with a tenant-free execution.

| Capability | Preimage form |
| --- | --- |
| None | `{"mode": "none"}` |
| One or more tenants | `{"mode": "scoped", "ids": [...]}` |
| Cross-tenant administrative | `{"mode": "all"}` |

For `scoped`, `ids` contains 1 to 100 distinct tenant identifiers. Each is a
non-empty string of at most 256 UTF-8 bytes. They are sorted by their UTF-8
bytes and duplicates are removed, because a tenant set is a set.

### Row limit

`rowLimit` is the smallest of the query's `limit`, the dataset's maximum
result size, any caller budget `maxRows` (RFC 0014), and any endpoint policy
ceiling. It is `null` when none applies. It is a non-negative integer no
larger than 2^53 − 1.

The query's own `limit` is then omitted from the normalized query, because
`rowLimit` already carries its effect. A request for 500 rows capped to 100
shares an entry with a request for 100 rows, and it should.

## Preimage

The preimage is the RFC 8785 canonical UTF-8 serialization of this object:

```json
{
  "kind": "hypequery-cache-preimage",
  "version": 1,
  "definition": "<definitionIdentity>",
  "query": { "...": "normalized query" },
  "tenant": { "mode": "..." },
  "rowLimit": 100
}
```

The project and environment are not included. RFC 0013 already binds them into
the entry MAC.

### Normalized query

The normalized query is a closed object. Every field is always present, and
`null` means "not requested".

| Field | Dataset | Metric | Normalization |
| --- | --- | --- | --- |
| `kind` | yes | yes | As given |
| `dataset` | yes | yes | As given |
| `metric` | — | yes | As given |
| `dimensions` | yes | yes | Absent becomes `[]`; order and duplicates preserved |
| `measures` | yes | — | Absent becomes `null`; present keeps order and duplicates |
| `filters` | yes | yes | Absent becomes `[]`; sorted and deduplicated (below) |
| `segments` | yes | yes | Absent becomes `[]`; sorted by UTF-8 bytes |
| `orderBy` | yes | yes | Absent becomes `[]`; order preserved |
| `by` | yes | yes | Absent becomes `null` |
| `offset` | yes | yes | Absent or `0` becomes `null` |

`includeMeta` and `limit` are removed.

The reasons for each rule:

- **`dimensions`, `measures` and `orderBy` keep their order.** Column order and
  row order are part of the result a caller receives.
- **`measures` absent stays distinct from `[]`.** Absent means every measure,
  while an empty list means none. They select different columns.
- **`filters` and `segments` are sorted.** Both are combined with AND, so their
  order cannot change rows. RFC 0015 says the same of `segments`. RFC 0015's
  "canonical encoding preserves it as authored" governs the query artifact.
  The preimage is a different artifact and is free to normalize.
- **Filters are sorted by bytes.** Each filter is serialized under RFC 8785 and
  the filters are sorted by those UTF-8 bytes. Filters with identical bytes are
  collapsed, since `A AND A` is `A`.
- **`offset` 0 is null.** Skipping no rows is the same request as not asking.
- **`includeMeta` is removed.** It changes response metadata, not rows. A cache
  stores rows and rebuilds metadata per call.

Filter values stay in their RFC 0001 tagged form. Two filters that mean the same
thing but are written differently, such as `in ["a"]` and `eq "a"`, are **not**
merged. Recognizing semantic equivalence is out of scope, and an extra miss is
the safe outcome.

## Excluded facts

These never enter the preimage. Adding any of them would either break sharing
or leak nothing useful:

- `correlationId`, `queryId`, `activationRevision`, and trace identifiers;
- deadlines, cancellation, `deadlineMs`, and query settings, which change
  whether a result arrives, not which rows it has;
- `includeMeta`;
- credentials, principals, roles, and capabilities themselves. Only the tenant
  scope a capability grants is recorded, never the capability object.

## Validation order

Checks run in this order, and the first failure determines the code:

1. `HQ_CACHE_PREIMAGE_INVALID_DEFINITION`: `definitionIdentity` is not 64
   lowercase hexadecimal characters.
2. `HQ_CACHE_PREIMAGE_INVALID_QUERY`: `query` fails expression extension 2
   validation. The underlying `HQ_EXPRESSION_*` code is not surfaced, so this
   family's code set stays closed.
3. `HQ_CACHE_PREIMAGE_INVALID_TENANT`: `tenant` has an unknown mode, an extra
   field, an empty or oversized `ids`, or an invalid identifier.
4. `HQ_CACHE_PREIMAGE_INVALID_LIMIT`: `rowLimit` is neither `null` nor a
   non-negative safe integer.

A preimage above RFC 0013's 1,048,576-byte limit is rejected by RFC 0013 itself
when the key is derived.

## Security considerations

- **Two tenants never share an entry.** Different tenant sets produce
  different `ids`. `none`, `scoped` and `all` are distinct modes, so a
  tenant-free execution, a tenant-scoped one, and an administrative one never
  collide.
- **The preimage contains raw tenant identifiers and filter values.** That is
  acceptable only because RFC 0013 keeps the preimage in memory and turns it
  into a keyed MAC. Implementations MUST NOT log it, emit it in events or
  diagnostics, or use it as a key. The privileged-diagnostics permission in
  RFC 0013 does not relax RFC 0011: raw tenant identifiers stay prohibited in
  diagnostic projections.
- **No caller-supplied value can widen a scope.** Tenant scope comes only from
  the resolved capability, and `rowLimit` can only shrink the result.
- **Semantic equivalence is not attempted.** An unrecognized equivalence costs
  a miss. A wrong equivalence would serve wrong rows.

## Open questions

1. **Raw identifiers or a fingerprint.** Should `ids` hold raw tenant
   identifiers or the RFC 0011 `tenantFingerprint`? Raw identifiers need no
   second secret and stay memory-only. A fingerprint would make an accidental
   preimage leak less damaging, but RFC 0011 does not yet define how the
   fingerprint is derived. This draft uses raw identifiers.
2. **Local definition identity.** Should the local-definitions digest be
   specified, so that a local TypeScript runtime and a local Python runtime
   share entries? This draft leaves it implementation-defined.
3. **Limits.** Are 100 tenant identifiers and 256 bytes per identifier the
   right bounds?
4. **Where it lives.** Should this be an amendment inside RFC 0009 rather than
   a standalone RFC? This draft keeps it separate so RFC 0009's acceptance
   does not wait on cache details.

## Fixtures

Draft fixtures live in `specs/security-protocol/drafts/cache-preimages-v1/`.
They move to `fixtures/` and are registered in `manifest.json` when this RFC is
accepted. Registering them earlier would freeze a Proposed contract, which is
what acceptance is for.

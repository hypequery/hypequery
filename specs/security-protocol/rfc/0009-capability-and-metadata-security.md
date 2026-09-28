# RFC 0009: Capability and metadata security

- Status: Accepted
- Accepted: 2026-09-28
- Version: capability contract 1, cache preimage 1

Acceptance freezes capability contract 1 and cache preimage 1. Changing a
capability class, a construction rule, the tenant fingerprint derivation, the
preimage fields or normalization, the validation order, or a stable code now
requires a new version, not an edit.

## Summary

This RFC defines the capability model that authorizes tenant-scoped execution,
cross-tenant administration, and privileged diagnostics across Hypequery
runtimes, together with the public metadata contract and the invariants that
keep capabilities outside every protocol artifact.

A capability is an opaque runtime value created only by a trusted server
component. It is never data: no request, deployment contract, bundle, release,
cache entry, log, or event can construct, carry, or alter one. Protocol
artifacts declare enforcement *requirements* (endpoint policies, tenant modes);
capabilities are the runtime *decisions* that satisfy them. Authentication,
tenant resolution, and authorization implementations remain runtime concerns
outside this protocol; this RFC defines the contract those components must
satisfy.

## Capability classes

Version 1 defines three capability classes.

### Tenant capability

Created by the runtime's tenant resolver after authentication. It is bound to
exactly one tenant context within one deployment target (project and
environment) and authorizes execution of tenant-required and tenant-optional
endpoints for that tenant only. A tenant capability is never valid for another
tenant, another target, or any administrative action.

### Cross-tenant administrative capability

Created by control-plane authorization. It authorizes deployment lifecycle
actions — submission, activation, and activation history — within the target
scope the authorizer grants. Administrative capabilities are never created by,
usable by, or visible to the data plane.

### Privileged-diagnostic capability

Created by control-plane or support authorization. It authorizes access to
privileged diagnostic projections beyond the public metadata and default event
contracts. Diagnostic access is always audited, and the capability never
authorizes query execution or lifecycle actions by itself. The audit record
contract is deferred to a future audit RFC building on the RFC 0011 event
model; until it is accepted, "audited" requires at minimum an append-only,
server-written record of the accessor principal, the capability class, the
target, and the access time — never a client-writable log line.

## Construction rules

- Capabilities are created only by trusted server components: the
  authenticator, the tenant resolver, and control-plane authorization.
- The authenticator's principal is the sole source of role and scope
  assertions. Request input — headers, query parameters, bodies, or tokens
  beyond the opaque credentials passed to the authenticator — MUST NOT
  contribute roles, scopes, tenant identity, or administrative status.
- Tenant identity is established only by the tenant resolver from the
  authenticated principal and the deployment's declared tenant policy. There is
  no ambient, default, or inherited tenant context.
- Every authorization check fails closed. A missing, unknown, expired, or
  mismatched capability results in denial; absence of a tenant capability on a
  tenant-required endpoint results in denial, not a tenant-free execution.
- A tenant-optional endpoint executes in exactly one of two modes: with a
  tenant capability, in which case tenant predicates MUST be applied exactly
  as on a tenant-required endpoint; or without one, in which case the
  execution is tenant-free and MUST NOT return tenant-scoped data.
  "Optional" describes whether the caller must present a tenant context,
  never whether tenant predicates apply when one is present.
- Relationship traversal MUST NOT widen tenant scope. RFC 0006 makes
  `hasMany` relationships metadata-only in version 1 to prevent aggregate
  fan-out; that restriction is a security invariant of this capability model,
  not a convenience, and every runtime executing relationship queries under a
  tenant capability MUST honor it.

## Non-serializability and non-constructibility

- A capability has no RFC 0001 tagged representation and no canonical bytes.
  Values outside the canonical value model cannot be encoded, so a capability
  cannot appear in any canonical artifact by construction.
- Deployment contracts (RFC 0006), bundles (RFC 0007), releases (RFC 0008),
  and query schemas and implementations (RFCs 0004 and 0005) MUST NOT define
  capability fields. Their validators already reject unknown fields, and this
  rejection is part of the capability boundary.
- No request field may construct or influence a capability. Fields asserting
  tenant proof, administrative flags, roles, or scopes are prohibited and MUST
  be rejected.
- Capabilities MUST NOT be written to caches, logs, query events, diagnostic
  projections, or error payloads. A cache key derives from capability-relevant
  context (target, tenant, and endpoint policy) through server-side derivation;
  it never contains a capability, raw tenant value, or credential. The cache
  preimage section below defines that derivation.

## Public metadata contract

Public metadata is the information a runtime may return to an unauthenticated
or unauthorized caller. It MUST be computable without any capability and MUST
NOT contain:

- physical sources, column names, or connection details;
- SQL text, expression SQL artifacts, or runtime artifact bytes;
- tenant policies, tenant identifiers, or tenant values;
- secrets, credentials, or environment values;
- privileged diagnostic content.

Public metadata is a projection of the deployment contract, not the contract
itself: the contract carries execution policy for trusted runtimes, while the
public projection carries only presentation and portable schema information
suitable for discovery. Unknown fields in public metadata fail closed under
the same versioning policy as the underlying artifacts.

## Threat-model examples

Each example states the attacker goal, the invariant that defeats it, and the
required behavior.

### Missing tenant

Goal: reach a tenant-required endpoint without a tenant context, or ride on an
ambient/default tenant. Invariant: tenant identity comes only from the tenant
resolver, and tenant-required endpoints fail closed. Required behavior: the
request is denied; no default tenant is substituted; tenant context is never
inherited from another request, a URL component, or a cache entry.

### Forged administrative scope

Goal: assert roles, scopes, or administrative status through request input.
Invariant: the authenticator is the sole source of the principal, and
administrative actions require control-plane authorization per action and
target. Required behavior: request-supplied assertions are ignored or
rejected; submission, activation, and history each require their own
authorization decision; the data plane has no path to administrative
capabilities.

### Joins across tenant boundaries

Goal: use a dataset relationship to read another tenant's rows. Invariant: a
tenant capability is bound to one tenant context and authorizes no other.
Required behavior: tenant predicates apply to every dataset joined by a
query; `hasMany` remains metadata-only so aggregate fan-out cannot widen
scope; a relationship never grants access to rows outside the caller's tenant
capability.

### Cache confusion

Goal: obtain another tenant's cached response. Invariant: cache keys derive
server-side from target, tenant context, and endpoint policy, and responses
are publicly cacheable only for public endpoints with tenant not required.
Required behavior: identical inputs from two tenants cannot produce a shared
hit; authenticated or tenant-aware responses are never marked publicly
cacheable; no cache key or value contains a capability, raw tenant value, or
credential. On a tenant-optional endpoint, "tenant context" is explicit: when
a tenant capability is present, the cache key MUST incorporate the derived
tenant fingerprint and the response is tenant-aware for caching purposes, so
it is never publicly cacheable and never shares a key with tenant-free
executions; only an execution without a tenant capability may share a key
with other tenant-free executions of the same endpoint.

### Log and event exposure

Goal: recover tenant values, credentials, inputs, results, or SQL from logs or
query events. Invariant: capabilities and their underlying values are never
written to logs or default events. Required behavior: logs and default query
events are metadata-only; parameter values, raw tenant identifiers, SQL, and
credentials are absent; redaction cannot be disabled by request input.

### Developer-tool privilege confusion

Goal: use a local developer tool to bypass endpoint policy. Invariant:
developer tools cannot mint capabilities; they obtain them only through the
same authenticator and tenant resolver as any other client. Required behavior:
tool-invoked portable endpoints enforce the same endpoint policies; no local or
loopback trust substitutes for a capability; credentials never appear in
browser-reachable code.

### Diagnostic projection leakage

Goal: reach privileged diagnostics through public metadata or default events.
Invariant: privileged diagnostic projections require the diagnostic capability
and are separate from public metadata and default events. Required behavior:
public metadata and default events contain no diagnostic content; every
diagnostic access is authorized and audited; a diagnostic capability alone
grants no execution or lifecycle access.

## Tenant fingerprint

A tenant fingerprint is how tenant scope appears anywhere outside the tenant
capability itself. It lets a component tell two tenants apart without learning
who either one is. It is the `tenantFingerprint` field of RFC 0011, and the
form tenant scope takes in a cache preimage.

```text
input       = "hypequery.tenant.fingerprint.v1" || 0x00 || UTF-8(tenantId)
fingerprint = lowercase-hex(HMAC-SHA-256(secret, input))       // 64 chars
```

- `secret` is a namespace secret meeting RFC 0013's secret rules: at least 32
  random bytes, distinct per project and environment, and never shipped in an
  artifact. For a cache preimage it MUST be the namespace's RFC 0013
  cache-key secret. The domain string keeps fingerprints independent of cache
  keys derived from the same secret, and a cache then needs no second secret.
- Rotating the secret changes every fingerprint. For a cache that is intended:
  rotation is already a flush under RFC 0013.
- A tenant identifier is any non-empty string. Encoding follows JavaScript's
  `TextEncoder`: an unpaired surrogate becomes U+FFFD.
- An unkeyed digest MUST NOT be used. Tenant identifier spaces are small
  enough to enumerate, which is the same reason RFC 0013 uses an HMAC.

## Cache preimage

RFC 0013 turns a canonical preimage into an opaque store key, and leaves the
preimage's contents to the containing query contract. This section is that
contract for dataset and metric queries, as cache preimage version 1. It fixes
which facts identify a cached result, so any two runtimes build the same bytes
for the same request and different bytes whenever the rows could differ.

Getting it wrong has three costs:

- **A missing fact that changes rows serves wrong data.** Leaving out tenant
  scope is the cache confusion threat above.
- **An extra fact that does not change rows means the cache never hits.** A
  per-call `correlationId` is an example.
- **The same fact encoded two ways splits entries.** Across languages, it also
  means TypeScript and Python never share an entry.

### Inputs

A runtime builds the preimage from these inputs. All of them come from the
server side, after authentication and tenant resolution. None comes from a
request field other than the semantic query itself.

| Input | Source |
| --- | --- |
| `query` | The RFC 0003 semantic query, validated under expression extension 2 (RFC 0015) |
| `definitionIdentity` | Identity of the definitions that execute the query |
| `tenant` | The tenant capability present on the execution |
| `secret` | The namespace's RFC 0013 cache-key secret, used for tenant fingerprints |
| `rowLimit` | The effective maximum row count the runtime will return |

`definitionIdentity` is 64 lowercase hexadecimal characters. It MUST change
whenever anything that affects result rows changes: dimension and measure SQL,
sources, joins, segments, tenant keys, and dataset limits. For a released
deployment it MUST be the RFC 0007 bundle identity. Otherwise it is
implementation-defined, so local entries are never shared with released
entries or across implementations. That is safe: an unshared entry only costs
a miss.

`tenant` records the capability present on the execution, whether or not the
target dataset applies a tenant predicate:

| Capability | Preimage form |
| --- | --- |
| None | `{"mode": "none"}` |
| One or more tenants | `{"mode": "scoped", "fingerprints": [...]}` |
| Trusted all-tenant execution | `{"mode": "all"}` |

`all` is an execution the runtime itself scopes to every tenant, such as a
scheduled server-side job. No request can reach it, and it is not the
cross-tenant administrative capability above: that capability never touches
the data plane. The mode exists so that such executions can be cached without
ever sharing an entry with a tenant-free or tenant-scoped one.

For `scoped`, each tenant identifier is replaced by its tenant fingerprint. The
fingerprints are then sorted and deduplicated, because a tenant set is a set.
Raw tenant identifiers never enter the preimage.

`rowLimit` is the smallest of these, or `null` when none applies:

- the query's `limit`;
- the dataset's maximum result size;
- any caller budget `maxRows` (RFC 0014);
- any endpoint policy ceiling.

It is a non-negative integer no larger than 2^53 − 1. It replaces the query's
own `limit`, so a request for 500 rows capped to 100 shares an entry with a
request for 100.

### Preimage

The preimage is the RFC 8785 canonical UTF-8 serialization of:

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

Project and environment are left out: RFC 0013 already binds them into the
entry MAC.

The normalized query is a closed object. Every field is always present, and
`null` means "not requested".

| Field | Dataset | Metric | Normalization |
| --- | --- | --- | --- |
| `kind`, `dataset` | yes | yes | As given |
| `metric` | — | yes | As given |
| `dimensions` | yes | yes | Absent becomes `[]`; order and duplicates kept |
| `measures` | yes | — | Absent becomes `null`; present keeps order and duplicates |
| `filters` | yes | yes | Absent becomes `[]`; sorted and deduplicated |
| `segments` | yes | yes | Absent becomes `[]`; sorted by UTF-8 bytes |
| `orderBy` | yes | yes | Absent becomes `[]`; order kept |
| `by` | yes | yes | Absent becomes `null` |
| `offset` | yes | yes | Absent or `0` becomes `null` |

`includeMeta` and `limit` are removed. The reasons for each rule:

- **Column and row order are part of the result.** So `dimensions`, `measures`
  and `orderBy` keep their order.
- **An absent `measures` selects every measure, and `[]` selects none.** So the
  two stay distinct.
- **`filters` and `segments` combine with AND, so their order cannot change
  rows.** Filters are sorted by the UTF-8 bytes of each filter's RFC 8785 form,
  and identical ones collapse. RFC 0015's rule that canonical encoding
  "preserves [segments] as authored" governs the query artifact, not this
  derived one.
- **`offset` 0 skips no rows.**
- **`includeMeta` changes response metadata, not rows.** A cache stores rows
  and rebuilds metadata on every call.

Filters that mean the same thing but are written differently, such as
`in ["a"]` and `eq "a"`, are not merged. An unrecognized equivalence costs a
miss, while a wrong one would serve wrong rows.

These never enter the preimage:

- `correlationId`, `queryId`, `activationRevision`, and trace identifiers;
- deadlines, cancellation, budget `deadlineMs`, and query settings;
- `includeMeta`;
- credentials, principals, roles, and the capability objects themselves.

### Validation order

The first failing check determines the code:

1. `HQ_CACHE_PREIMAGE_SECRET_MISSING`, then
   `HQ_CACHE_PREIMAGE_SECRET_TOO_SHORT`: the RFC 0013 secret rules.
2. `HQ_CACHE_PREIMAGE_INVALID_DEFINITION`: `definitionIdentity` is not 64
   lowercase hexadecimal characters.
3. `HQ_CACHE_PREIMAGE_INVALID_QUERY`: `query` fails expression extension 2
   validation. The underlying `HQ_EXPRESSION_*` code is not surfaced.
4. `HQ_CACHE_PREIMAGE_INVALID_TENANT`: any of the following:
   - an unknown mode or an extra field;
   - a `scoped` capability with no tenants;
   - a tenant identifier that is not a non-empty string.
5. `HQ_CACHE_PREIMAGE_INVALID_LIMIT`: `rowLimit` is neither `null` nor a
   non-negative safe integer.

There is no separate cap on tenant count or identifier length. Fingerprints
are a fixed size, and RFC 0013 bounds the whole preimage at 1,048,576 bytes.

**A preimage failure never fails a request.** A runtime that cannot build a
preimage, or derive a key from it, MUST execute that call without caching and
MUST NOT substitute any other key. Whether the call is allowed at all is
decided by the execution path, as usual. Caching is optional, so a request that
is too large to cache is simply not cached.

The `cache-preimages-v1` fixture family pins every rule above.

## Stable failure codes

Capability checks produce no serialized capability, but their denials are
observable. Runtimes surface them with these stable codes:

- `HQ_CAPABILITY_MISSING`: no capability was presented for an endpoint that
  requires one.
- `HQ_CAPABILITY_CLASS_MISMATCH`: the presented capability belongs to a
  different class than the action requires.
- `HQ_CAPABILITY_TENANT_REQUIRED`: no tenant capability was resolved for a
  tenant-required endpoint.
- `HQ_CAPABILITY_TENANT_MISMATCH`: the presented tenant capability does not
  match the tenant context the execution would use.

These codes classify denials only; they carry no tenant values, capability
material, or policy detail beyond the class of failure.

The public error envelope and its categories are defined by RFC 0010. Denials
map onto its categories as follows:

- `HQ_CAPABILITY_MISSING` and `HQ_CAPABILITY_CLASS_MISMATCH` map to
  `unauthenticated` or `forbidden`, depending on the authentication state.
- `HQ_CAPABILITY_TENANT_REQUIRED` maps to `tenant-required`, the category for
  a denial caused only by an unresolved tenant context.
- `HQ_CAPABILITY_TENANT_MISMATCH` maps to `forbidden`.

Over HTTP, `unauthenticated` is status 401 and every other denial is 403.

## Security

The capability boundary holds when capabilities remain server-created,
opaque, non-serializable, scoped to class and target, and checked fail-closed
on every request. Protocol artifacts declare what enforcement an endpoint
requires; runtime components decide whether a caller satisfies it. Keeping
those two planes disjoint — requirements in artifacts, decisions in runtime —
is what allows independently implemented runtimes to agree on security
behavior without sharing authentication implementations.

# RFC 0009: Capability and metadata security

- Status: Proposed
- Version: capability contract 1

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
  it never contains a capability, raw tenant value, or credential.

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

### Studio privilege confusion

Goal: use a local Studio session to bypass endpoint policy. Invariant: Studio
cannot mint capabilities; it obtains them only through the same authenticator
and tenant resolver as any other client. Required behavior: Studio-served
portable endpoints enforce the same endpoint policies; no local or loopback
trust substitutes for a capability; Studio-held credentials never appear in
browser-reachable code.

### Diagnostic projection leakage

Goal: reach privileged diagnostics through public metadata or default events.
Invariant: privileged diagnostic projections require the diagnostic capability
and are separate from public metadata and default events. Required behavior:
public metadata and default events contain no diagnostic content; every
diagnostic access is authorized and audited; a diagnostic capability alone
grants no execution or lifecycle access.

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

The public error envelope and its categories are defined by the forthcoming
RFC 0010. Until it is accepted, denials use an HTTP response carrying an
error object with a stable `code` and a safe `message`: status 401 when
authentication is absent or rejected, 403 otherwise. The RFC 0010 mapping is
then: `HQ_CAPABILITY_MISSING` and `HQ_CAPABILITY_CLASS_MISMATCH` map to
`unauthenticated` or `forbidden` as the authentication state dictates;
`HQ_CAPABILITY_TENANT_REQUIRED` maps to `tenant-required`, the
protocol-specific category for a denial caused solely by an unresolved
tenant context (surfaced as 403 until RFC 0010 defines the envelope); and
`HQ_CAPABILITY_TENANT_MISMATCH` maps to `forbidden`.

## Security

The capability boundary holds when capabilities remain server-created,
opaque, non-serializable, scoped to class and target, and checked fail-closed
on every request. Protocol artifacts declare what enforcement an endpoint
requires; runtime components decide whether a caller satisfies it. Keeping
those two planes disjoint — requirements in artifacts, decisions in runtime —
is what allows independently implemented runtimes to agree on security
behavior without sharing authentication implementations.

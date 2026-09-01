# Decision 0004: Cloud routing, authentication, and agent access

- Status: Proposed
- Date: 2026-08-31
- Owners: Hypequery Cloud and Core maintainers

## Context

A hosted MCP request must select one Cloud deployment target, authenticate a
human or service principal, resolve tenant context, and execute against the
correct active generation. The target and tenant cannot be left to model tool
arguments. The first-party Cloud agent must not receive broader access than an
external MCP client acting for the same user.

## Decision

### Endpoint and target binding

One hosted MCP endpoint binds to exactly one Cloud project and environment. The
initial public shape is conceptually:

```text
https://mcp.hypequery.com/{project}/{environment}
```

Cloud may use an equivalent versioned route or verified custom domain, but the
target is derived from the authenticated endpoint and never appears in an MCP
tool schema. Organization membership and target authorization are checked even
when the bearer credential is otherwise valid.

The MCP endpoint is an OAuth protected resource. The resource identifier is the
canonical target endpoint, preventing a token intended for one endpoint from
being replayed as authority for another. Interactive clients use OAuth; service
automation may use scoped API tokens or JWTs accepted by the same principal
mapping boundary.

### Authorization

Cloud-level scopes are:

- `mcp:discover` for capability, tool, resource, and prompt discovery; and
- `mcp:invoke` for tool calls.

These scopes grant access to the gateway operation only. Dataset and metric
roles/scopes declared in the active deployment contract are additionally
required. Project/environment authorization is always checked. Required roles
and scopes use all-of semantics, matching the deployment data plane.

Discovery is filtered to callable objects, but invocation repeats all checks
against the pinned active generation.

### Tenant resolution

Cloud resolves tenant context from the authenticated principal and a trusted
project-specific mapping. A deployment may name the claim/mapping strategy in
provider configuration, but no tenant value is accepted from MCP tool input,
query parameters, model messages, or client-controlled metadata.

A missing or ambiguous tenant fails closed when the endpoint requires one.
Administrative all-tenant access requires an explicit trusted principal policy
and runtime representation; it is not inferred from a missing tenant.

### Gateway and runtime trust boundary

The gateway verifies credentials, resolves the target, loads authorization-safe
discovery, applies gateway quotas, and calls `DeploymentHost`. Database
credentials and runtime secrets are resolved only for the activated runtime.
They are never returned to the gateway's MCP serialization layer or agent
harness.

Gateway instances should remain stateless beyond MCP transport/session needs.
Activation, deployment contracts, principal sources, and quota/metering stores
remain authoritative external state. Caches are keyed by deployment identity
and authorization shape and cannot weaken per-call authorization.

### First-party agent

The Cloud agent harness uses a delegated user token or a narrowly scoped
service token bound to the initiating principal, target, and tenant mapping. It
uses the same discovery and invocation operations as external clients.

An internal call path may avoid public-network OAuth exchange, but it must
produce the same principal, enforce `mcp:discover`/`mcp:invoke` and deployment
policy, pin the same activation revision, consume the same query budgets, and
emit the same audit record. There is no global agent superuser path.

### Quotas and audit

Cloud applies bounded concurrency, request rate, query cost, response bytes,
and plan usage in addition to contract and Core execution limits. The effective
limit is always the most restrictive applicable ceiling.

Every discovery and invocation records a request/trace ID, principal reference,
target, activation/release/deployment identity, tool name, outcome, duration,
budget usage, and redacted error category. Raw results, prompts, and tool
arguments follow explicit customer retention policy and are not required for
the audit event.

## Consequences

- Copying a hosted endpoint is sufficient to identify the deployment target;
  tools remain focused on analytics arguments.
- Cloud authentication adds to rather than replaces deployment endpoint policy.
- The same user should observe equivalent authorization through an external MCP
  client and the first-party agent.
- OAuth metadata, token audience/resource checks, delegated credentials, and
  tenant mappings become required Cloud integration tests.

## Rejected alternatives

- **A single global MCP endpoint with project and tenant tool arguments:**
  rejected because models could influence routing and authorization boundaries.
- **API tokens as the only authentication mechanism:** rejected because
  interactive remote MCP clients require a user authorization flow.
- **Gateway-only authorization:** rejected because cached discovery and runtime
  calls still require contract policy enforcement.
- **An internal agent superuser:** rejected because it creates a second product
  and security boundary.

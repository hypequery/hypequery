# Decision 0002: Semantic invocation and activation pinning

- Status: Proposed
- Date: 2026-08-31
- Owners: Hypequery Core and Cloud maintainers

## Context

The deployment contract already carries datasets, metrics, endpoint access
policy, tenant policy, and limits. The deployment data plane currently makes
only `deployment.queries` executable. Dynamic Dataset and metric requests from
MCP therefore cannot yet use the same authenticated, generation-pinned path as
named queries.

Encoding every possible dynamic semantic request as a static named query is not
practical. Adding a generic Cloud callback would duplicate validation and make
the activated contract descriptive rather than authoritative.

## Decision

`@hypequery/deployment` will add first-class semantic invocation alongside
named-query execution. The exact TypeScript names remain an implementation
detail until the corresponding PR, but the operation has this logical shape:

```ts
type DeploymentSemanticInvocation = {
  target: { project: string; environment: string };
  activationRevision?: string;
  operation:
    | { kind: 'dataset'; dataset: string; query: ProtocolDatasetQuery }
    | {
        kind: 'metric';
        dataset: string;
        metric: string;
        query: ProtocolMetricQuery;
      };
  credentials?: unknown;
  signal?: AbortSignal;
};
```

The implementation must validate away redundant or conflicting identifiers in
the nested protocol query. It may instead normalize to one identifier location,
provided the portable request remains closed and unambiguous.

Semantic invocation reuses the named-query data-plane sequence:

1. Select the exact active deployment generation.
2. Resolve the dataset or metric from that generation's validated contract.
3. Authenticate credentials when required.
4. enforce all required roles and scopes;
5. resolve tenant context through the provider callback;
6. derive and apply the most restrictive query budget;
7. validate and detach semantic input;
8. execute through the native semantic adapter or activated runtime;
9. validate and byte-limit output; and
10. return a stable, redacted result or error.

The caller cannot provide a tenant value. The provider-resolved tenant is passed
only through trusted execution context. The semantic adapter is responsible for
the contract's `auto-inject` or `manual` tenant behavior and must fail closed
when a required tenant cannot be enforced.

## Generation pinning

Discovery and execution must refer to a coherent generation:

- Tool discovery is derived from one validated active deployment generation.
- The discovery response identifies its activation revision in protocol
  metadata.
- A subsequent tool call carries or resolves the listed revision as trusted
  session/request context, not as a model-controlled tool argument.
- The deployment host rejects the call with a stable stale-generation category
  if that revision is no longer active.
- A capable client receives a tool-list-changed notification. Other clients get
  a correctable stale-contract error and must relist before retrying.
- A rollback creates a new activation revision even when it selects an older
  release, so an ABA transition cannot satisfy a stale caller.

Calls already admitted to a generation follow the existing drain rules. New
calls never cross from schemas/policy in one generation to execution in
another.

## Runtime boundary

The MCP gateway does not import user source or construct a ClickHouse client.
It invokes the deployment host. Runtime secrets are resolved inside the hosted
generation and never enter MCP tool descriptions, model context, tool
arguments, or public errors.

The semantic executor may be portable native execution or a supervised runtime
binding. Both implement the same invocation contract and policy context. A
temporary catch-all named query is not the target architecture.

## Failure categories

The provider-neutral layer distinguishes at least:

- invalid or unavailable configuration;
- target or semantic operation not found;
- unauthenticated and forbidden;
- required tenant unavailable;
- invalid semantic input;
- budget exceeded or cancelled;
- stale activation generation;
- executor unavailable or failed; and
- invalid executor output.

Stable concrete codes are finalized with the implementation and must not expose
provider exceptions. Trusted telemetry may retain bounded causes.

## Consequences

- Dataset and metric tools become deployable without a second MCP config.
- Named-query and semantic execution share security and lifecycle behavior.
- The deployment host gains a second operation family but remains the one
  generation-pinned execution boundary.
- Activation races require explicit integration tests covering discovery,
  invocation, replacement, draining, and rollback.

## Rejected alternatives

- **Generate one static named query for every possible tool call:** rejected
  because semantic arguments are dynamic and schemas are dataset-specific.
- **Put tenant in the MCP input schema:** rejected because a model must not
  select its authorization boundary.
- **Let the gateway execute `DatasetClient` directly:** rejected because it
  bypasses deployment generation and secret ownership.
- **Silently execute on the newest activation:** rejected because discovery and
  execution could apply different contracts.

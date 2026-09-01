# Deployment transport specifications

These documents define how immutable Hypequery releases move through authenticated intake, activation, runtime startup, and named-query hosting.

They build on the identities and closed artifacts in [`specs/security-protocol`](../security-protocol/README.md). Transport, authentication, authorization, persistence, and HTTP behavior may be defined here, but they must never weaken artifact validation.

| Spec | Contract |
| --- | --- |
| [0001](./0001-authenticated-deployment-submission.md) | Streaming authenticated submission |
| [0002](./0002-target-activation.md) | Immutable target activation and compare-and-swap |
| [0003](./0003-control-plane-http.md) | Provider-neutral control-plane HTTP routes |
| [0004](./0004-runtime-materialization.md) | Revalidated immutable runtime snapshots |
| [0005](./0005-runtime-supervision.md) | Readiness, generation switching, invocation, and draining |
| [0006](./0006-data-plane-execution.md) | Route policy, schemas, dispatch, and output validation |
| [0007](./0007-data-plane-hosting.md) | Generation-pinned host assembly and shutdown |

Architecture decisions shared by Core and Cloud are recorded under
[`decisions/`](./decisions/README.md). The language-neutral MCP/Cloud vertical
slice used by those decisions lives under
[`fixtures/mcp-cloud-v1/`](./fixtures/mcp-cloud-v1/README.md).

# Deployment transport specifications

These documents record deployment transport and execution designs. The live
deployment contract is the dataset and derived-measure contract in
[`RFC 0006`](../security-protocol/rfc/0006-dataset-deployment-contract.md).
Named-query hosting and customer runtime artifacts described in older designs
are not part of the live deployment flow.

They build on the identities and closed artifacts in [`specs/security-protocol`](../security-protocol/README.md). Transport, authentication, authorization, persistence, and HTTP behavior may be defined here, but they must never weaken artifact validation.

| Spec | Contract |
| --- | --- |
| [0001](./0001-authenticated-deployment-submission.md) | Streaming authenticated submission |
| [0002](./0002-target-activation.md) | Immutable target activation and compare-and-swap |
| [0003](./0003-control-plane-http.md) | Provider-neutral control-plane HTTP routes |
| [0004](./0004-runtime-materialization.md) | Historical runtime materialization design |
| [0005](./0005-runtime-supervision.md) | Historical runtime supervision design |
| [0006](./0006-data-plane-execution.md) | Historical named-query execution design |
| [0007](./0007-data-plane-hosting.md) | Historical host assembly design |

Architecture decisions shared by Core and Cloud are recorded under
[`decisions/`](./decisions/README.md). The historical language-neutral
MCP/Cloud vertical slice used by those decisions lives under
[`fixtures/mcp-cloud-v1/`](./fixtures/mcp-cloud-v1/README.md).

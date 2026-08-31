# Deployment architecture decisions

These records capture product and implementation boundaries shared by the open
source Hypequery packages and Hypequery Cloud. They complement the normative
protocol RFCs under [`specs/security-protocol`](../../security-protocol/README.md)
and the provider-neutral deployment specifications in the parent directory.

A decision does not create a new public wire format. Any shape that must be
portable across implementations requires a protocol RFC, strict validators,
canonical fixtures, and compatibility tests before it becomes normative.

| Decision | Subject | Status |
| --- | --- | --- |
| [0001](./0001-mcp-transport-and-ownership.md) | MCP transport and package ownership | Proposed |
| [0002](./0002-semantic-invocation-and-activation-pinning.md) | Dataset/metric invocation and activation pinning | Proposed |
| [0003](./0003-agent-safe-catalog-results-and-errors.md) | Safe discovery, tool manifests, results, and errors | Proposed |
| [0004](./0004-cloud-routing-auth-and-agent-access.md) | Cloud routing, authentication, tenancy, and first-party agent access | Proposed |

The shared vertical-slice fixture referenced by these records lives in
[`../fixtures/mcp-cloud-v1`](../fixtures/mcp-cloud-v1/README.md).

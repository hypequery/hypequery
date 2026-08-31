# Decision 0001: MCP transport and ownership boundaries

- Status: Proposed
- Date: 2026-08-31
- Owners: Hypequery Core and Cloud maintainers

## Context

`@hypequery/mcp` currently combines MCP method handling, hand-written tool
schemas, local Dataset instances, `DatasetClient`, and stdio transport in one
server. Hypequery Cloud needs a Streamable HTTP endpoint backed by an activated
deployment rather than a process-local Dataset registry. A first-party Cloud
agent also needs the same tools.

Implementing a second MCP server in Cloud would allow tool schemas, tenant
behavior, result shapes, and errors to drift. Letting the first-party agent call
the database or Dataset runtime directly would create a privileged execution
path that external clients cannot exercise or verify.

## Decision

MCP support is split into a transport-neutral protocol adapter and environment
adapters.

The transport-neutral MCP core:

- implements MCP tools, resources, prompts, capability negotiation, tool call
  dispatch, result mapping, and MCP-safe error mapping;
- consumes a catalog provider and a semantic execution port rather than a
  concrete `DatasetClient` or deployment host;
- receives a request context containing cancellation and opaque trusted
  execution context supplied by the environment;
- has no dependency on stdio, HTTP, OAuth, Cloud routing, credential storage,
  ClickHouse connection construction, or model-provider APIs; and
- produces the same tool definitions and call results for equivalent local and
  hosted catalogs.

The environment adapters are:

1. **Local stdio:** loads trusted application configuration, creates the local
   Dataset execution adapter, supplies an explicitly trusted tenant context,
   and connects the MCP core to stdio.
2. **Cloud Streamable HTTP:** authenticates the remote request, resolves one
   project/environment target and active generation, supplies the deployment
   semantic execution adapter, and connects the same MCP core to Streamable
   HTTP.
3. **First-party agent:** behaves as an MCP client. An internal-network or
   in-process optimization may avoid serialization, but it must call the same
   tool executor with the same principal, policy, tenant, budget, and revision
   checks.

## Package ownership

| Package or service | Owns |
| --- | --- |
| `@hypequery/datasets` | Semantic definitions, catalog construction, exact query schemas, local query validation/planning, and local execution adapters |
| `@hypequery/mcp` | Transport-neutral MCP behavior, safe discovery projection consumption, tool/result/error mapping, and the stdio adapter |
| `@hypequery/protocol` | Portable deterministic contract types, validators, canonical encoding, and identities accepted through the RFC process |
| `@hypequery/deployment` | Generation-pinned dataset/metric and named-query execution, policy context, cancellation, and provider-neutral host interfaces |
| Cloud MCP gateway | Streamable HTTP, credential verification, target routing, authorization-aware discovery, quotas, tracing, and operational lifecycle |
| Cloud agent harness | Model/run orchestration, conversation state, streaming, rendering, model usage, and evaluation hooks |

Cloud does not maintain a second dataset registry or copy Core schema-generation
logic. Core does not contain provider-specific OAuth, storage, billing, or Cloud
route code.

## Compatibility

Existing stdio tool names remain supported. A refactor may add a public
transport-neutral constructor and generated tools, but it does not delete a
released export. New tool modes are explicit capabilities and do not silently
change the meaning of an existing tool name.

The deployment contract is the hosted source of truth. Local configuration and
an equivalent deployed contract must produce the same logical catalog, schema,
and execution result, excluding environment metadata such as trace and
activation identities.

## Consequences

- Local MCP improvements directly benefit hosted MCP.
- Cloud can scale transport and operations independently of semantic logic.
- The first-party agent continuously tests the public MCP product boundary.
- A transport-neutral MCP core must be introduced before the hosted gateway can
  merge against production behavior.
- Request context and semantic execution interfaces become deliberate public or
  provider-facing APIs and require focused compatibility tests.

## Rejected alternatives

- **A separate Cloud MCP implementation:** rejected because schemas, policy,
  limits, and errors would drift.
- **Cloud loading the user's MCP config:** rejected because source configuration
  is not the activated immutable deployment boundary.
- **The Cloud agent calling ClickHouse directly:** rejected because it bypasses
  the governed external interface.
- **Raw SQL as the shared execution port:** rejected because it moves semantic
  validation and tenant safety outside the trusted runtime.

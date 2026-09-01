# Decision 0003: Agent-safe catalog, results, and errors

- Status: Proposed
- Date: 2026-08-31
- Owners: Hypequery Core and Cloud maintainers

## Context

The current MCP package builds query schemas separately from the Dataset tool
generator and returns JSON encoded only as text. Introspection includes physical
sources, columns, SQL expressions, measure fields, and tenant-key metadata that
an agent does not need. Cloud also needs deterministic tool definitions tied to
an immutable deployment generation.

## Decision

### One catalog and schema generator

`@hypequery/datasets` owns the canonical logical catalog and query-tool schema
generator. Local Dataset instances and portable deployment contracts each have
an adapter into the same logical catalog shape. MCP consumes the generated
definitions; it does not maintain field or operator lists by hand.

Generated input schemas are closed and bounded. They include exact dataset,
metric, field, operator, order, and grain choices; integer bounds; dataset-level
limits; and the requirement for at least one dimension or measure in an ad-hoc
dataset query.

Tool definitions, tool names, enum values, and other set-like arrays use a
documented deterministic order. A tool-manifest identity will be derived from a
validated, safe manifest using RFC 8785 JSON and domain-separated SHA-256. Until
that shape is accepted as a protocol RFC, the identity is an internal cache and
diagnostic key rather than a public portable artifact identity.

### Safe and debug catalog projections

The default agent-safe projection contains only information needed to choose and
call tools:

- logical dataset, dimension, measure, metric, filter, and relationship names;
- type, label, description, examples, synonyms, units/format, supported grains,
  and safe defaults;
- filter/operator and groupability capabilities;
- logical relationship targets and fields when queryable; and
- effective query limits and pagination behavior.

It excludes by default:

- physical database, table, source, and column names;
- SQL expression text and dependencies;
- measure input fields and compiled statements;
- tenant key fields, tenant columns, and tenant values;
- artifact digests, runtime entrypoints, source paths, and secrets; and
- authorization claims or policies that reveal inaccessible objects.

A trusted debug projection may expose selected physical diagnostics only after
separate authorization. It is not included in model context by default and is
never a substitute for server-side policy enforcement.

Tool discovery is authorization-aware. Objects the principal cannot call are
not advertised, and every call is authorized again to prevent discovery caches
from becoming security decisions.

### Tool modes

The stable compatibility tools remain available:

- `list_datasets`;
- `get_dataset_schema`;
- `query_dataset`; and
- `query_metric`.

Per-dataset and per-metric tools are generated modes over the same catalog. A
hosted hybrid may add verified per-metric tools and bounded per-dataset tools,
then fall back to catalog tools when tool-count or description-byte budgets are
reached. The fixture for this decision pins the compatibility-tool mode so its
output is small and deterministic.

### Structured results

Query tools return MCP `structuredContent` conforming to a declared output
schema. The model-visible query result is:

```ts
type SemanticToolResult = {
  data: Array<Record<string, unknown>>;
  meta: {
    rowCount: number;
    pagination?: { limit: number; offset: number; hasMore: boolean };
  };
};
```

A concise JSON text representation of the same value remains as a compatibility
fallback. SQL is excluded unless a trusted local/debug policy explicitly opts
in.

Operational metadata belongs in MCP protocol metadata rather than the semantic
rows presented to the model. It may include trace ID, timing, cache outcome,
deployment identity, release identity, activation revision, and tool-manifest
identity. Metadata is bounded and redacted.

### Errors

MCP maps provider-neutral failures into stable public categories:

- correctable input;
- unauthenticated;
- forbidden;
- tenant unavailable;
- budget exceeded;
- cancelled;
- stale contract;
- temporarily unavailable; and
- internal failure.

Errors contain a stable code, safe message, optional bounded input path, and
retry/relist hints. They never contain SQL, credentials, tenant values, physical
source details, stack traces, or raw provider exceptions.

## Fixture status

[`../fixtures/mcp-cloud-v1/expected-tools.json`](../fixtures/mcp-cloud-v1/expected-tools.json)
is a non-normative expected MCP `tools/list` response for the shared vertical
slice. It guides Core and Cloud implementation tests but does not become a
public artifact schema merely by being checked in.

## Consequences

- Local and hosted MCP schemas can be compared byte-for-byte after environment
  metadata is removed.
- Richer semantic metadata requires bounded additive catalog/protocol changes.
- Physical introspection becomes an explicit privileged feature rather than the
  default agent experience.
- Structured data can be rendered by clients without asking a model to parse
  prose or reconstruct values.

## Rejected alternatives

- **Continue hand-writing MCP schemas:** rejected because the runtime validator
  and advertised schema can disagree.
- **Expose the full deployment contract as discovery:** rejected because it
  leaks unnecessary physical and security details.
- **Return text only:** rejected because it loses typed data and makes reliable
  tables, charts, and downstream tools harder.
- **Treat hidden tools as sufficient authorization:** rejected because listing
  and execution can race or be bypassed.

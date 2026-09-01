# MCP and Cloud vertical-slice fixture v1

This directory pins the shared input and expected discovery surface for local
MCP, hosted MCP, and the first-party Cloud agent. It is the integration fixture
for deployment decisions 0001 through 0004.

The fixture is intentionally **non-normative**. It does not define a new public
artifact version. A portable shape becomes normative only through the security
protocol RFC and conformance process.

## Files

| File | Purpose |
| --- | --- |
| [`deployment.json`](./deployment.json) | Valid deployment contract v1 with one tenant-scoped orders dataset and one named metric |
| [`context.json`](./context.json) | Fixed target, generation, authorized principal, and server-resolved tenant used by hosted tests |
| [`expected-safe-catalog.json`](./expected-safe-catalog.json) | Logical agent-safe projection expected from the deployment |
| [`expected-tools.json`](./expected-tools.json) | Deterministic MCP `tools/list` result for compatibility-tool mode |
| [`clickhouse.sql`](./clickhouse.sql) | Optional local ClickHouse schema and two-tenant seed data |
| [`questions.json`](./questions.json) | Three deterministic semantic calls and expected rows for `tenant_acme` |

## Pinned identities

The canonical deployment contract identity is:

```text
2d71d44577daffdc952ef55d640ece588a74fc6493f0857c5851325745af890a
```

It is SHA-256 over the deployment v1 identity domain followed by the RFC 8785
canonical bytes, as defined by security protocol RFC 0006. The activation,
release, and bundle identities in `context.json` are recognizable fixed fixture
values rather than identities of a complete release bundle.

## Expected behavior

An authorized principal with the context in `context.json` sees exactly these
compatibility tools, sorted by name:

1. `get_dataset_schema`
2. `list_datasets`
3. `query_dataset`
4. `query_metric`

The generated schemas must:

- advertise only the `orders` dataset and `totalRevenue` metric;
- advertise exact logical dimensions, measures, filters, operators, grains,
  order fields, and limits;
- require at least one dimension or measure for `query_dataset`;
- apply an effective default and maximum result size of 100;
- reject unknown fields and bound offset at 10,000 for this product fixture; and
- contain no tenant argument.

The safe catalog and tool manifest must not expose:

- `analytics.orders`;
- `tenant_id` or the tenant value;
- mappings to physical columns such as `created_at`, `order_id`, or the internal
  non-queryable `amount` field;
- measure input fields or aggregation implementation details;
- runtime artifacts, SQL, credentials, roles, or scopes.

The generic dataset description in the expected safe catalog is a deterministic
fallback because deployment contract v1 does not yet carry dataset-level
description. Later additive agent metadata may replace the fallback only through
an explicit fixture update and compatibility review.

## Data and tenant invariant

`clickhouse.sql` contains three rows for `tenant_acme` and one high-value row for
`tenant_globex`. Every expected answer in `questions.json` is for
`tenant_acme`. Returning the Globex row causes a conspicuous revenue mismatch
and fails the tenant-isolation invariant.

The SQL file drops and recreates `analytics.orders`; test harnesses must run it
only in an isolated disposable ClickHouse environment. Reading or validating
the fixture never executes the SQL.

## Intended test progression

1. `CORE-03` validates that local Dataset and deployment-contract adapters
   produce `expected-tools.json` from one catalog generator.
2. `CORE-06` validates the safe catalog and forbidden physical fields.
3. `CORE-12` activates the contract and executes dataset/metric calls with the
   pinned principal, tenant, and activation revision.
4. `CLOUD-04` runs the same calls through Streamable HTTP.
5. `CORE-13` and `AGENT-04` replay `questions.json` through local, hosted, and
   agent paths.

Tests may copy or materialize these values, but they should not maintain a
second semantically equivalent fixture in a package-specific directory.

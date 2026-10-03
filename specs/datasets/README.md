# Dataset authoring and execution checks

`common-authoring-v1.json` is a shared deployment v2 snapshot covering a physical
source, tenant and time fields, logical dimensions, base measures and a fixed
measure filter. TS and Python authoring tests independently build it and compare
the complete contract, including ordering and default filter operators.

The authoritative feature matrix is
`packages/datasets/src/execution-capabilities.json`, shipped through
`DATASET_EXECUTION_CAPABILITIES`. TS tests probe local compilation, actual
publication and portable compilation. Python tests probe native planning,
authoring rejection and publication/semantic-query boundaries. Both separately
check protocol v3 fixtures to prevent protocol acceptance being mistaken for
runtime feature support.

The matrix describes repository implementations, not a hosted service rollout.
It covers the named semantic feature families, not every possible combination of
SQL expressions, relationships, operators or query-builder capabilities. Query
and contract validators remain authoritative for a concrete definition.

New portable features must update representation, authoring/export, rehydration,
execution and these probes. Native planner result parity still requires shared
query fixtures and ClickHouse integration coverage; these authoring fixtures do
not establish byte-identical SQL or full TS/Python execution equivalence.

Run:

```sh
pnpm --filter @hypequery/datasets test
uv run --project python/hypequery pytest python/hypequery/tests/test_dataset_execution_capabilities.py
```

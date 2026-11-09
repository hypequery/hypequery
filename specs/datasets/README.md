# Dataset authoring and execution checks

`common-authoring-v1.json` is a shared deployment v2 snapshot covering a physical
source, tenant and time fields, logical dimensions, base measures and a fixed
measure filter. TS and Python authoring tests independently build it and compare
the complete contract, including ordering and default filter operators.

`merge-authoring-v1.json` is the same kind of snapshot for merge measures over
stored aggregate states (RFC 0022): estimating and exact `uniq` states, `count`
and `sum` states, and a derived measure over them. TypeScript generates it
(`vitest -u` in `packages/datasets`); Python must build the identical contract.

`time-measures-corpus-v1.json` is the RFC 0015 execution corpus for window and
shift measures on sparse series: source tables and rows, language-neutral
dataset definitions, queries, and the expected rows (measure values as strings,
as over HTTP) or refusal message. It covers filled buckets, lookback before the
range, nullable partitions, the query timezone, calendar clamping at month ends
and leap days, interval-conversion boundaries, the result limit and the
1,000-bucket bound. TypeScript is the reference: with ClickHouse running,
`HYPEQUERY_UPDATE_CORPUS=1` on `src/tests/integration/time-measures-corpus.test.ts`
rewrites `expected`. Python's `tests/test_time_measures_corpus_live.py` must
reproduce every case, including column order and messages.

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

---
name: manual-test
description: Execute one of the model-runnable E2E test specs in testing/ (cli, datasets, serve, mcp, react) against a real ClickHouse instance. Use when asked to manually test a package, run a testing spec, or verify a package end-to-end against live data.
---

# Manual test spec runner

Execute a spec from `testing/` end-to-end. These specs are written to be run by a model, not a script — read the spec fully, then follow its journeys in order.

## Arguments

The user names a package or spec: `cli`, `datasets`, `serve`, `mcp`, `react`, or `semantic` (→ `semantic-type-safety-manifest-testing.md`). If none given, ask which one, and mention the recommended order: CLI → Datasets → Serve → MCP → React (later specs reuse the `Target` dataset defined in the datasets spec §0.6; React additionally needs the serve app from the serve spec running).

## Preflight (do this before opening the spec)

1. Verify env vars are set: `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD`. If missing, stop and ask the user for connection details — the specs run against their real, already-populated database.
2. Confirm connectivity with a cheap query (e.g. `SELECT 1` via curl or the client).
3. `pnpm build` from the repo root so the packages under test are current.

## Rules of engagement

- **Read-only by default.** The specs only read from ClickHouse. The single exception is the CLI schema-refresh journey (cli spec J2), which creates and drops a throwaway table and needs DDL privileges — ask before running it, and skip it if the user can't create tables.
- No seed data, no magic numbers: introspect the schema and pick suitable tables/columns per the spec (datasets spec §0.4), then verify outputs against ground truth computed from raw ClickHouse SQL over the same table.
- Leave the artifacts behind for inspection (`hq-*-test/` directories, `sql/` dumps, `out/*.json`, running apps). Don't clean them up unless asked.

## Reporting

When the run finishes, report:

1. **Pass/fail per journey**, with the failing step and observed vs expected output for any failure.
2. **Doc-accuracy findings**: any mismatch between the docs (`website-next/content/docs/`) and actual behavior goes in the spec's Appendix A format. These are doc/code bugs to file — track them separately from test pass/fail, and don't mark already-**FIXED** appendix items as new findings.
3. Paths to the inspectable artifacts produced.

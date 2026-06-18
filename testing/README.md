# hypequery — Manual Testing Specs

End-to-end, hand-to-a-model test plans for each published package. Every spec is
self-contained, runs against a **real ClickHouse instance**, and leaves behind an
**inspectable app** (source files, SQL dumps, OpenAPI/manifest descriptors, tool
responses, or a running web UI) you can open and read afterward.

## Specs

| Spec | Package | Builds |
| --- | --- | --- |
| [`cli-testing-spec.md`](./cli-testing-spec.md) | `@hypequery/cli` | scaffolded `analytics/` projects via `init`/`generate`/`dev` |
| [`datasets-testing-spec.md`](./datasets-testing-spec.md) | `@hypequery/datasets` | `hq-datasets-test/` — canonical `Orders` dataset, `sql/` dump, vitest suite |
| [`serve-testing-spec.md`](./serve-testing-spec.md) | `@hypequery/serve` | `hq-serve-test/` (+ optional Next.js) — runtime with queries/metrics/datasets, auth, CORS, rate limiting, observability |
| [`mcp-testing-spec.md`](./mcp-testing-spec.md) | `@hypequery/mcp` | `hq-mcp-test/` — MCP config + registry + stdio driver writing tool responses to `out/` |
| [`react-testing-spec.md`](./react-testing-spec.md) | `@hypequery/react` | `hq-react-test/` (Vite+React, + optional Next.js) — live-rendering hooks |

## Real ClickHouse — no seeding

All specs run against **your own, already-populated ClickHouse**. There is **no seed**;
the tests only **read**. Set `CLICKHOUSE_URL` / `CLICKHOUSE_DATABASE` /
`CLICKHOUSE_USERNAME` / `CLICKHOUSE_PASSWORD` to point at the database you want exercised.

The model **introspects your schema and picks suitable tables/columns** (see
`datasets-testing-spec.md` §0.4), then:
- builds dimensions/measures over a chosen fact-like table `T` (numeric `Nᵢ`, low-cardinality `C`, timestamp `TS`, a column `K` used as tenant key);
- verifies dataset/metric output against **ground truth computed from raw ClickHouse SQL** over the same table — so assertions hold on whatever real data you point at, with no magic numbers.

The serve, MCP, and React specs reuse that same `Target` dataset, so define it once
(datasets spec §0.6) and import/rebuild it in the others.

> The **only** scenario that writes to ClickHouse is the CLI schema-refresh journey
> (`cli-testing-spec.md` J2), which creates and drops a clearly-named throwaway table and
> requires DDL privileges. Skip it if you can't create tables.

## Recommended run order

1. **CLI** — verifies scaffolding/codegen/dev server against your real schema.
2. **Datasets** — introspects your schema, builds the `Target` dataset, verifies the semantic layer + SQL generation vs raw-SQL ground truth. Establishes the dataset definition reused downstream.
3. **Serve** — exposes that dataset's metrics over HTTP; emits `out/manifest.json` and `out/openapi.json`.
4. **MCP** — exposes the same datasets to agents over stdio.
5. **React** — consumes the running serve API (needs the serve app from step 3 alive, and its `manifest.json`).

## What each spec produces (inspect these)

- **datasets:** `hq-datasets-test/sql/*.sql` (generated SQL), passing `vitest` run.
- **serve:** `hq-serve-test/out/{openapi,describe,manifest,client-config}.json`, plus a live API at `:4000` you curl and view at `/docs`.
- **mcp:** `hq-mcp-test/out/*.json` (every tool response + the `dataset_guide` prompt).
- **react:** a running Vite app rendering live data + a screenshot; `tsc --noEmit` green.

## Docs-accuracy findings

Each spec ends with an **Appendix A** listing discrepancies found between the docs and
actual behavior. Several first-pass findings have already been fixed in code/docs (the
`--version` hardcode, the non-existent `npx hypequery serve` reference in
`http-openapi.mdx`, and the CLI `generate:datasets` message's broken `createBackend`
import) and are marked **FIXED** in the appendices. Remaining items are behaviors to
confirm during a live run — treat any new mismatch as a doc/code bug to file, separate
from test pass/fail.

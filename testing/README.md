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

## Shared ClickHouse setup

All specs share one ClickHouse instance with **two databases**:

- **`analytics`** — created in `cli-testing-spec.md` §0.2–0.3 (tables `users`, `events`, `orders`). Used only by the CLI spec.
- **`ds_test`** — the canonical seed in `datasets-testing-spec.md` §0.4 (tables `orders` + `users`). Reused by the **datasets, serve, MCP, and React** specs, because they all build on the same `Orders` dataset. Those apps set `CLICKHOUSE_DATABASE=ds_test`.

> Start the container once (CLI spec §0.2), then apply both seeds. The CLI spec's
> `analytics.orders` and the shared `ds_test.orders` have **different schemas** — don't
> point a dataset-based app at `analytics.orders`.

## Recommended run order

1. **CLI** — verifies scaffolding/codegen/dev server. Standalone (`analytics` DB).
2. **Datasets** — seeds `ds_test`; verifies the semantic layer + SQL generation. Establishes the exact expected numbers reused downstream.
3. **Serve** — exposes the datasets/metrics over HTTP; emits `out/manifest.json` and `out/openapi.json`.
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

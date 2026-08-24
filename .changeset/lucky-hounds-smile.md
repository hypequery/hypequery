---
"@hypequery/cli": minor
---

Four CLI fixes found while setting up a Next.js project.

**Reads `.env.local`.** The CLI loaded only `.env`, so a Next.js or Vite project
with its ClickHouse credentials in `.env.local` — the convention those frameworks
use, and the file the app itself reads — could not connect. Worse, the failure
was reported as `Unable to detect database type. Re-run with --database`, which
sends you after the wrong problem entirely. The CLI now reads the same cascade
those frameworks do, most specific first: `.env.$NODE_ENV.local`, `.env.local`,
`.env.$NODE_ENV`, `.env`. Earlier files win and real environment variables beat
all of them, so existing `.env`-only setups are unaffected.

**Reports the number of tables generated, not discovered.** `generate --tables
ontime` against a 79-table database printed `Found 79 tables` and `Generated
types for 79 tables` while correctly generating exactly one. The filter worked;
the message made it look broken. Both commands now say
`Found 79 tables, filtering to 1` and `Generated types for 1 table`.

**`generate:datasets` defaults to `analytics/datasets.ts`.** It previously wrote
`src/datasets/generated.ts` while its sibling `generate` wrote
`analytics/schema.ts`, splitting generated output across two trees. The new
default matches the docs, matches `generate`, and matches `findDatasetsFile`,
which already searched `analytics/datasets.ts` first. **This changes where the
command writes when neither `--output` nor `--path` is given**; pass
`--output src/datasets/generated.ts` to keep the old location.

**The "Next steps" example matches the generated file.** It was hardcoded to
`import { datasets } from './datasets/generated'` and `datasets.orders`,
regardless of where the file went or which tables were in it. It now uses the
real import path and the first real dataset name, so it can be pasted as-is.

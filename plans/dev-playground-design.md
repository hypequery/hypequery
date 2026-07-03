# Dev Server → Playground Design

Date: 2026-07-03
Status: proposed
Sources: `packages/serve/src/dev.ts` (current `serveDev`), closed PR #126 / branch
`claude/enhance-dev-server-storage-WRp4W` (donor implementation: `packages/serve-ui`,
`packages/serve/src/dev-ui`, `packages/serve/src/cache`), `packages/serve/src/semantic/datasets`,
`packages/datasets` (semantic contract, tool schemas), `packages/mcp-server`, `packages/schema`.

## Vision

`hypequery dev` becomes the place you live while building an analytics API: browse
datasets and metrics, run them against ClickHouse (local or Cloud), watch query history
stream in live, and ask an AI to write, explain, and debug queries — local-first, with
the AI constrained to the same governed semantic layer that production consumers and
MCP agents use. Same philosophy as the MCP server: agents never write raw SQL.

Personas and jobs:

- **Builder** (defining datasets/queries): "Did my metric work? What SQL did it generate?
  Why is it slow?" → execute, SQL viewer, history, timing.
- **Integrator** (wiring a frontend/agent): "What endpoints exist, what shapes?" →
  registry, schema-driven forms, copy-as-curl/fetch.
- **Explorer** (new to the data): "What's in this ClickHouse?" → schema explorer + AI
  chat over the semantic contract. (Secondary persona — builder and integrator are core.)

### Positioning vs the ClickHouse Cloud console

The CH Cloud console is a *database* tool: raw SQL against tables, schema browsing,
text-to-SQL over the raw schema. The playground is an *analytics API* tool: it operates
one layer up, on the thing you're actually shipping — datasets, metrics, typed endpoints,
auth guards, tenant isolation, serve-layer cache. Concretely, the console cannot: run an
endpoint as tenant X and verify isolation; show cache hit/miss or pipeline validation
errors; tell an integrator what the API contract is; or constrain AI to governed metric
definitions rather than arbitrary SQL. And it only exists for Cloud — the playground's
dev loop is identical against local/self-hosted ClickHouse. Where the two overlap (schema
browsing, raw SQL), the console wins and we don't compete: the schema explorer here is
AI-grounding and convenience, and the raw-SQL scratchpad stays a gated Phase 4 item.
Analogy: pgAdmin vs Postman — same database underneath, different layer, both used.

## Prior art: PR #126 is a parts donor, not a mergeable unit

Branch `claude/enhance-dev-server-storage-WRp4W` (closed unmerged 2026-03-07, +13k lines)
built a React playground (query history, cache stats, SSE live updates, schema-driven
execute forms), a storage layer, a batched dev query logger, and a serve-layer cache.
Reusable: UI components, `QueryHistoryStore` interface + tests, SSE handler (heartbeats
correctly `unref`'d), cache layer, endpoint routing shape.

Why it cannot merge as-is (verified 2026-07-03):

- Merge-base is 2026-03-06; `main` has since rewritten ~9.5k lines in `packages/serve`
  including the whole `semantic/` layer. Seven files conflict directly (`dev.ts`,
  `types.ts`, `index.ts`, `pipeline.ts`, `server/builder.ts`, `server/define-serve.ts`,
  `package.json`); the branch's `pnpm-workspace.yaml` predates the datasets/schema/
  mcp-server packages.
- The playground only discovers `api.queries` — it cannot see semantic dataset/metric/
  contract endpoints, which are the point of this project.
- 530KB of embedded UI (~30% of serve's dist) reachable from the root package entry via
  `export * from "./dev.js"` — parsed by every consumer including Vercel/edge prod.
- `better-sqlite3` native addon (silent memory fallback on install failure; two store
  backends that can drift). `node:sqlite` (Node ≥22.5) has since made it unnecessary.
- `serve-ui` commits its own npm `package-lock.json` inside the pnpm workspace; serve's
  build shells `npm run build` into it and silently falls back to an empty UI on failure.
- `POST /__dev/playground/execute` calls `api.execute()` directly, bypassing auth guards.
- History DB defaults to global `~/.hypequery/dev-queries.db` (cross-project bleed);
  branch also committed 14 junk `.hypequery/tmp/bundle-*` files.

Phase 0 cherry-picks donor code file-by-file onto main; never `git merge` the branch.

## Architecture

### Package layout and bundle-size strategy

The production runtime carries **zero playground bytes and zero new dependencies**. The
entire playground — dev API backend (registry, history, storage, SSE, AI proxy) *and*
the built UI — lives in one dev-only package; serve gains only a mount hook.

1. **`@hypequery/serve` changes are minimal**: an optional `mount` handler option on
   `serveDev` (~20 lines) plus a `"./dev"` subpath exporting `serveDev` and the small
   dev-integration interface (pipeline execute with auth context, query-logger
   subscription, contract access — most already public). Root `index.ts` keeps a
   `@deprecated` `serveDev` re-export (policy: deprecate shipped APIs, don't remove).
   The AI SDK, storage code, and SSE machinery do NOT enter serve's dependency tree.
   The serve-layer cache (`src/cache/`) does land in serve — it is a runtime feature
   useful in production, not playground bloat.
2. **`@hypequery/playground`** (dev-only, dependency of the CLI): the dev handler
   (`/__dev/*` API) + brotli-compressed built UI assets. `hypequery dev` wires it into
   `serveDev` automatically; without it installed, `serveDev` still works as the plain
   thin server with an install hint. Prod installs of serve never download it.
3. **UI stack is plain React 18** — not Preact. The assets are served locally from disk,
   so framework size is nearly irrelevant there; the donor components port unchanged;
   and it keeps a straight path to the hosted cloud workspace (website-next is already
   React/Next). Size discipline comes instead from: route-level code-splitting, lazy
   chunks for Prism + sql-formatter (load on first SQL view), no heavyweight chart lib
   (uPlot-class or nothing until Phase 4).
4. **CI budgets**: playground asset bundle ≤ 500KB compressed; serve's dist may not grow
   more than a few KB from the mount hook + interface. Fail the build otherwise.

```
packages/serve                 runtime; exports "." (unchanged) and "./dev" (mount hook,
  src/cache/                   integration interface); serve-layer cache (donor, reconciled)
packages/playground            dev handler (/__dev API, storage, SSE, AI proxy) + built UI
  ui/                          React 18 + Vite source (pnpm — no npm lockfile)
packages/cli                   `hypequery dev` gains --no-ui; depends on playground
```

### Dev API surface (all under `/__dev`, dev-only)

```
GET  /__dev/registry        queries + datasets + metrics from the semantic contract:
                            schemas, tags, source
POST /__dev/execute         run any endpoint via the REAL pipeline (auth/tenant/rate-limit)
GET  /__dev/history, /__dev/history/:id, /__dev/sse
GET  /__dev/cache           POST /__dev/cache/clear
GET  /__dev/schema          ClickHouse introspection (system.tables / system.columns)
POST /__dev/ai/chat         streaming AI proxy (Phase 3)
GET  /__dev/health          ClickHouse reachable? which host? AI configured?
```

UI served at `/__dev` (root `/` stays prod-identical). SSE drives live history/cache.

### Execution and security

- **Execute through the pipeline, not around it.** Playground runs the full
  auth/tenant/rate-limit pipeline with a dev-context picker (tenant, roles, simulated
  auth) — doubles as an auth-debugging feature.
- **Localhost-only by default.** Non-localhost bind with dev UI enabled requires
  `HYPEQUERY_DEV_TOKEN`; `/__dev/*` then requires it. Hard requirement before ClickHouse
  Cloud credentials are in play.
- **AI never executes raw SQL.** Its tools are the semantic endpoints only (identical to
  MCP). A human raw-SQL scratchpad is Phase 4, gated off by default.
- Local-first: no telemetry; outbound calls only to the user's ClickHouse and (opt-in,
  BYOK) their AI provider.

### Storage

`node:sqlite` store at `<project>/.hypequery/dev.db` (CLI gitignores `.hypequery/`),
implementing the donor's `QueryHistoryStore` interface so its tests carry over. Memory
fallback on Node <22.5 with a loud log line. Retention: 10k rows / 7 days, configurable.

## ClickHouse Cloud

Execution against Cloud already works (`@hypequery/clickhouse` accepts any HTTPS URL).
The gap is experience:

- **Connection setup in the playground**: guided form (URL, user, password /
  `CLICKHOUSE_*` env detection), test-connection, TLS hints. Writes `.env`, never the DB.
- **Schema explorer** (`/__dev/schema`): introspect `system.tables`/`system.columns`
  (reuse/extend `packages/schema`); also grounds the AI.
- **Diagnostics**: human explanations for ClickHouse error codes; `system.query_log`
  stats (rows/bytes read) per run where permissions allow.
- **Out of scope**: the Cloud control-plane API (provisioning orgs/services/keys) —
  separate auth surface, no official Node SDK, no user job requires it yet.

## AI-native design

One source of truth: `@hypequery/datasets` already emits tool schemas (`toOpenAITools`,
MCP server). The playground AI consumes the same semantic contract. The playground chat
is the showcase and test bench for the MCP story, not a separate AI product.

Features by value:

1. **NL → query**: chat panel; AI picks a dataset/metric endpoint + typed inputs (tool
   call), executed through the pipeline; results in the same table/SQL viewer; runs land
   in history tagged `ai`.
2. **Explain**: generated SQL + contract context, one shot.
3. **Diagnose**: from a slow/failed history entry — SQL, timing, error, schema slice.
4. **Author-assist** (later): draft dataset definitions as copyable TS; never writes files.

Plumbing: server-side proxy `POST /__dev/ai/chat` (key stays server-side), streaming over
the existing SSE machinery. BYOK: `ANTHROPIC_API_KEY` present → feature lights up.
Default model `claude-sonnet-5`. Anthropic SDK direct behind a thin internal provider
interface (streaming chat + tools) so OpenAI-compatible providers are an adapter later —
no Vercel AI SDK dependency for now. The SDK dependency lives in `@hypequery/playground`,
never in `@hypequery/serve`.

Trust affordances: show the tool call (endpoint + inputs) alongside results; always show
generated SQL; "AI suggested — verify" labeling. Worst case is a wrong *governed* query,
never arbitrary SQL.

## Phases

| Phase | Scope | Effort |
|---|---|---|
| **0 — Foundation** | Cherry-pick donor parts into `@hypequery/playground`; serve mount hook + `"./dev"` subpath + deprecated root re-export; `node:sqlite`; pnpm throughout + CI hard-fail on missing assets + size budgets; per-project DB; localhost guard | ~1–1.5 wk |
| **1 — Playground core** | Semantic registry; execute-through-pipeline with dev auth context; history/SSE/cache screens; SQL viewer; copy-as-curl | ~1.5–2 wk |
| **2 — Cloud & schema** | Connection setup + test; schema explorer; error diagnostics | ~1 wk |
| **3 — AI** | Chat proxy; NL→query tool calls; explain; diagnose | ~1.5–2 wk |
| **4 — Later** | Author-assist; gated raw-SQL scratchpad; saved/shareable sessions; result charts; MCP-server parity audit | backlog |

Each phase ships independently behind `hypequery dev`. Schema explorer (2) precedes AI
(3) because AI grounding quality depends on it.

## Cloud trajectory (deliberately later)

Local dev server ships first; a hosted playground is the natural SaaS wedge afterwards
("team workspace": shared saved queries, team query history, org AI key, pointed at a
deployed serve instance). The architecture keeps that door open cheaply, and these
boundaries must be preserved as such:

- The UI speaks only the `/__dev` REST+SSE API — never Node internals — so the same UI
  can front a hosted control plane later.
- `HYPEQUERY_DEV_TOKEN` auth on `/__dev/*` generalizes to session auth.
- `QueryHistoryStore` is an interface; the cloud version backs it with Postgres/ClickHouse.
- The server-side AI proxy becomes the metered team feature.

Not doing cloud-first because: it front-loads auth/orgs/billing/secret-handling before
there's adoption to justify them; "credentials stay on your machine" is the trust story
a young tool needs; and the local playground doubles as user research for what a paid
workspace should contain.

## Risks

- **Bundle creep** → separate asset package + CI budget (above).
- **Node 22 floor for persistent history** → document; memory fallback logs loudly.
- **Merge friction** → donor code is cherry-picked parts, never a `git merge`.
- **Toolchain CVE surface** (Prism etc.) → playground-ui on pnpm joins the normal
  dependabot cadence; one lockfile.
- **AI demo-ware risk** → AI phase is explicitly the MCP showcase; if chat usage is low,
  the contract/tool-schema investment still pays off through MCP.
- **Scope vs maintenance budget** → UI stays thin (Preact, no design system beyond the
  donor's primitives); anything not serving builder/integrator jobs goes to Phase 4.

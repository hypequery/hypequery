# Dev Server → Playground Design

Date: 2026-07-03
Status: proposed
Sources: `packages/serve/src/dev.ts` (current `serveDev`), closed PR #126 / branch
`claude/enhance-dev-server-storage-WRp4W` (donor implementation: `packages/serve-ui`,
`packages/serve/src/dev-ui`, `packages/serve/src/cache`), `packages/serve/src/semantic/datasets`,
`packages/datasets` (semantic contract, tool schemas), and `packages/mcp-server`.

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
correctly `unref`'d), endpoint routing shape. (The donor cache layer was originally on
this list; superseded — see "Cache architecture" below.)

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
   Serve gains **no cache implementation** — result caching already lives in the two
   layers that own query semantics; the dev integration exposes cache *observability*,
   not storage (see "Cache architecture" below).
2. **`@hypequery/playground`** (dev-only, dependency of the CLI): the local *gateway* —
   implements the gateway contract (`plans/gateway-contract.md`) against serve's
   `DevIntegrationApi` and serves the studio's built assets same-origin at `/__dev`.
   `hypequery dev` wires it into `serveDev` via the mount option; without it installed,
   `serveDev` still works as the plain thin server with an install hint. Prod installs
   of serve never download it.
3. **`@hypequery/studio`** (OSS, publishable): the embeddable React UI core — components
   render against a `gatewayBaseUrl` + `/meta` capabilities. Ships source *and* a
   prebuilt dist that the gateway serves locally. The future Cloud app imports this
   package and wraps it with Cloud-only screens — one frontend, no fork.
4. **UI stack is plain React 18** — not Preact. The assets are served locally from disk,
   so framework size is nearly irrelevant there; the donor components port unchanged;
   and it keeps a straight path to the hosted cloud workspace (website-next is already
   React/Next). Size discipline comes instead from: route-level code-splitting, lazy
   chunks for Prism + sql-formatter (load on first SQL view), no heavyweight chart lib
   (uPlot-class or nothing until Phase 4).
5. **CI budgets**: playground asset bundle ≤ 500KB compressed; serve's dist may not grow
   more than a few KB from the mount hook + interface. Fail the build otherwise.

```
packages/serve                 runtime; exports "." (unchanged) and "./dev" (mount hook,
                               integration interface incl. cache observability)
packages/playground            local gateway: contract impl (/__dev API, storage, SSE,
                               AI proxy) + serves studio assets same-origin
packages/studio                embeddable React 18 UI core (Vite; pnpm — no npm lockfile);
                               ships source + prebuilt dist
packages/cli                   `hypequery dev` gains --no-ui; depends on playground+studio
```

### Delivery model (DECIDED 2026-07-05: Prisma model with embeddable core)

Three models were evaluated: bundled-local (Prisma), hosted UI + local API (Drizzle,
whose remote origin causes mixed-content/cert pain and trust objections), and a hybrid
(same-origin serving of a privately-developed UI via CLI fetch-and-cache). Final call:
**Prisma model** — UI fully OSS in this repo, shipped in the CLI dependency tree, served
same-origin, works offline/air-gapped, zero network fetches ever.

Chosen because: weeks-faster to ship (no private repo, no publish pipeline, no
version-pinning matrix); best trust posture for infra teams ("read the source, it's all
local"); version coherence (UI+gateway ship together); and the donor UI is already
public in git history. The known cost, accepted deliberately: **permanent loss of
license control over the UI** (anyone may embed it). hypequery's moat is the semantic
layer + Cloud control plane, not UI widgets; pre-adoption, distribution beats protection.

What preserves cloud-convertibility (non-negotiable design rules):
- The UI is an **embeddable core** (`@hypequery/studio`) speaking only the gateway
  contract, feature-gated by `/meta` capabilities — Cloud imports it, never forks it.
- Assets ship in the **CLI**, never in serve.
- Future premium screens may be closed *wrappers* around the open core in the Cloud repo.

Standard answer to "why not host the UI like Drizzle?": we serve same-origin so there is
no mixed-content dance and no third-party origin touching your database; and the gateway
contract is open — anyone can build their own UI against it.

### Gateway API surface (all under `/__dev`, dev-only)

Normative spec: `plans/gateway-contract.md` (contract v0). Summary:

```
GET  /__dev/meta            contractVersion, mode, capabilities[], project, clickhouse status
GET  /__dev/registry        queries + datasets + metrics from the semantic contract
POST /__dev/execute         run any endpoint via the REAL pipeline (auth/tenant/rate-limit)
GET  /__dev/history         (+ /history/:queryId, DELETE /history) — renamed from donor /queries
GET  /__dev/events          SSE: query lifecycle incl. generated SQL; heartbeat
GET  /__dev/cache           POST /__dev/cache/clear      (capability "cache")
GET  /__dev/schema          ClickHouse introspection     (capability "schema")
POST /__dev/ai/chat         streaming AI proxy           (capability "ai", Phase 3)
```

UI served at `/__dev` (root `/` stays prod-identical). SSE drives live history/cache.
CORS: same-origin default, explicit allowlist only — never `*` (replaces donor wildcard).

### Execution and security

- **Execute through the pipeline, not around it.** Playground runs the full
  auth/tenant/rate-limit pipeline with a dev-context picker (tenant, roles, simulated
  auth) — doubles as an auth-debugging feature.
- **Localhost-only by default.** Non-localhost bind with dev UI enabled requires
  `HYPEQUERY_DEV_TOKEN`; `/__dev/*` then requires it. Hard requirement before ClickHouse
  Cloud credentials are in play.
- **AI never executes raw SQL.** Its tools are the semantic endpoints only (identical to
  MCP). A human raw-SQL scratchpad is Phase 4, gated off by default.
- Local-first: user data never leaves the machine. Outbound calls are limited to the
  user's ClickHouse, (opt-in, BYOK) their AI provider, and — see below — anonymous
  usage telemetry.

### Cache architecture (DECIDED 2026-07-14 — supersedes the donor serve-layer cache)

The original plan ported the donor's serve-layer response cache
(`packages/serve/src/cache/*` from PR #126) as landing-sequence PR 1. That decision
predated #253 and is now reversed: **no serve-layer cache is built.** Result caching
stays in the two layers that own query semantics, and serve exposes observability only.

Why the donor cache is dropped:

- It would be a **third result cache**. The query-builder cache
  (`@hypequery/clickhouse` `core/cache/`: modes, table/join tags, `deleteByTag`,
  pluggable providers, `CacheController.getStats()`) and the semantic query cache
  (`@hypequery/datasets`, #253: canonical-signature keys, TTL + SWR, concurrent dedup,
  scope partitioning) already cover both execution paths. A serve response cache
  triple-stores the same rows and makes invalidation incoherent across layers.
- Its default key — `hq:{endpointKey}:{stableStringify(input)}` — **omits tenant/auth
  context**: a multi-tenant endpoint serves tenant A's cached rows to tenant B unless
  every author remembers the `keyGenerator` escape hatch. The real caches key on the
  actual query, where tenant filters already live. Adding a
  cross-tenant-leak-by-default cache contradicts the serve security roadmap.
- Its unique features are covered: SWR exists in both caches; pattern invalidation is
  the builder cache's `deleteByTag`; partitioning is the semantic cache's `scope`.
- The plan's open question ("does `api.execute()` honor cache?") was answered by #253:
  semantic endpoints execute through the shared `DatasetClient`, cache included.

What replaces it — **cache observability, not storage**:

1. Datasets: add hit/miss/stale counters plus `getStats()`/`clear()` to
   `SemanticQueryCache` (its store interface already has optional `clear()`).
2. Serve: expose `cacheObservability` on `DevIntegrationApi`, aggregating the layers —
   semantic (`SemanticQueryCache.getStats()`) and builder (`CacheController`, already
   publicly exported): `getStats(): Promise<CacheLayerStats[]>`, `clear(layer?)`.
3. Gateway: `GET /__dev/cache` returns per-layer stats (`{ layers: [...] }`);
   `POST /__dev/cache/clear` takes an optional layer. Clear support is advertised via
   the `cache:clear` sub-capability, only when a real cache is wired for clearing;
   when nothing is wired the gateway keeps its history-derived approximate stats
   (already implemented), omits `cache:clear`, and `clear` returns 503 as defense
   against capability-ignoring clients. Per-query cache fields on history/SSE come
   from semantic `meta.cache` (`hit`, `ageMs`, `stale`) flowing through results — no
   serve cache needed.

Usage guidance (docs, not code): semantic endpoints prefer the semantic cache (closer
to the response; gets dedup and scopes); the builder cache is for direct query-builder
code outside the semantic layer. Configuring both on the same path double-caches.

### Relationship to the security protocol (added 2026-07-14)

`specs/security-protocol/` is the language-neutral source of truth for contracts shared
by authoring tools, runtimes, Studio, and Cloud, and it forbids competing protocol
rules. The gateway contract therefore owns only the **dev transport** — paths, auth,
SSE mechanics, capability negotiation. Payload semantics that Cloud must share
(canonical value encoding, error codes, compiled-query/event envelopes) defer to
`specs/security-protocol` as those are accepted; where the two overlap, the protocol is
normative. Concretely: `/execute` results are plain JSON in contract v0 (with known
Int64/Decimal precision limits); a future `values-v1` capability will carry protocol
tagged values (RFC 0001) additively.

### Telemetry (added 2026-07-10 — supersedes the original "no telemetry" stance)

Decision: anonymous, opt-out usage telemetry, Next.js-style, to measure whether the
playground earns further investment (activation funnel: `gateway_started` →
`ui_served` → execute → return usage). Rules, enforced in
`packages/playground/src/telemetry.ts`:

- NEVER captures SQL, query/endpoint names (sha256-hashed only), inputs, results,
  hostnames, file paths, or credentials. Durations are bucketed, never exact.
- Anonymous machine UUID + hashed project id. No PII.
- Loud one-time disclosure on first enabled run; `GET /__dev/telemetry` reports the
  enabled state for transparency.
- Opt-out: `HYPEQUERY_TELEMETRY_DISABLED=1` or `DO_NOT_TRACK=1`; auto-disabled in CI;
  inert until an ingest endpoint is configured (`HYPEQUERY_TELEMETRY_ENDPOINT` or the
  `DEFAULT_ENDPOINT` constant — currently empty, so telemetry is a no-op in the wild).
- UI events go same-origin to the gateway beacon (`POST /__dev/telemetry`),
  allowlist-validated and prop-sanitized server-side; the browser never contacts a
  third party. Endpoint shapes are normative in `plans/gateway-contract.md`
  (capability `telemetry`); this section owns only the policy.
- Fire-and-forget: batched, 3s timeout, failures swallowed — telemetry may never slow
  or break the dev server.

The security-review talking point changes from "zero network calls ever" to "your
data never leaves localhost; anonymous feature-usage counts are sent unless you opt
out, and here is the exhaustive list of what they contain."

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
  through the existing ClickHouse client; also grounds the AI.
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

- The UI speaks only the gateway contract (REST+SSE) — never Node internals — and ships
  as the embeddable `@hypequery/studio` core, so the Cloud app imports the same frontend
  and mounts it against a hosted gateway implementation.
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
- **Scope vs maintenance budget** → UI stays thin (React 18, no design system beyond the
  donor's primitives); anything not serving builder/integrator jobs goes to Phase 4.
- **Open-UI embedding by third parties** → accepted cost of the Prisma model (see
  Delivery model); moat is the semantic layer + Cloud control plane.

## PR landing sequence (Phase 0–1)

Donor-branch salvage split into reviewable PRs. Sizes approximate; bugs found in review
are fixed during the split, not ported.

| # | PR | Contents | Depends on |
|---|---|---|---|
| 0 | Repo hygiene | gitignore `.hypequery/`; remove committed `.hypequery/tmp` artifacts & `dist-file-index.txt` (straight to main) | — (merged as #256) |
| 1a | Semantic cache stats | hit/miss/stale counters + `getStats()`/`clear()` on `SemanticQueryCache` in `@hypequery/datasets` (replaces the dropped donor serve-layer cache — see "Cache architecture") | — |
| 1b | Serve cache observability | `cacheObservability` on `DevIntegrationApi` aggregating semantic + builder (`CacheController`) layers | 1a, 2 |
| 2 | serve mount hook | already on branch (c01b51e): `StartServerOptions.mount`, `DevIntegrationApi`, `./dev` subpath, `@deprecated` root re-export | — |
| 3 | Gateway storage | `packages/playground/src/storage/*` on `node:sqlite` + dev query logger; per-project `.hypequery/dev.db`; donor tests ported; cache fields on history entries come from semantic `meta.cache` | — |
| 4 | Gateway API + SSE | contract v0 impl: `/meta`, `/registry` + `/execute` written fresh against `DevIntegrationApi` (donor tip deleted these), `/history` rename, `/events`; loopback/token guard; CORS allowlist; fix `query:completed` vs `query:complete` mismatch; delete dead `lastEventId` plumbing (replay later if needed); `serveDev` return shape does NOT change (composition lives in CLI); rename `serveCacheStore` → `cacheObservability` (history-derived fallback stays; full `cache` capability needs 1b) | 2, 3 |
| 5 | `@hypequery/studio` | embeddable React core (donor serve-ui as seed); `gatewayBaseUrl` + capability gating; fix `useSSE` 500ms polling → `onStateChange`, `useSSEEvent` effect-dep churn, debounced search; prebuilt dist + size budget CI | 4's contract only (parallel) |
| 6 | CLI wiring | `hypequery dev` composes gateway+studio via mount; `--no-ui`; fix stale `getTableCount` assertion in dev tests; evaluate donor `sync.ts` separately before porting | 4, 5 |
| 7 | Consumer smoke coverage | verify the mounted dev server through focused generated fixtures | all |

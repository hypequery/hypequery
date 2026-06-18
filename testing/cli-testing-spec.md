# hypequery CLI — Manual Testing Spec

A self-contained test plan for `@hypequery/cli`, written so it can be handed to an
agent/model and executed end-to-end **in a fresh repository** against a **real
ClickHouse instance**. Scenarios mirror how a real user adopts the tool, not just
flag-by-flag coverage.

- **Package under test:** `@hypequery/cli` (bin: `hypequery`)
- **Commands:** `init`, `dev [file]`, `generate`, `generate:types`, `generate:datasets`, `help [command]`
- **Peer packages it scaffolds/uses:** `@hypequery/clickhouse`, `@hypequery/serve`, `@hypequery/datasets`, `zod`

> ⚠️ Before running, read **Appendix A — Docs accuracy report**. Several documented
> flags don't exist, several real flags are undocumented, and a few options are
> accepted but currently ignored. The expected results below describe **actual CLI
> behavior**, which in places differs from `reference/api/cli.mdx`.

---

## 0. Prerequisites & environment

### 0.1 Tooling
- Node.js ≥ 18 (CLI targets node18; `dev` bundles TS with esbuild).
- One package manager to test with: `npm` (default). Optionally repeat key flows with `pnpm`/`yarn`/`bun` — the CLI auto-detects the manager from lockfile / `packageManager` / `npm_config_user_agent`.
- `curl` for hitting the dev server.

### 0.2 A real ClickHouse you control
Use ClickHouse Cloud **or** a local container. Local container (recommended for repeatable tests):

```bash
docker run -d --name hq-ch -p 8123:8123 -p 9000:9000 \
  -e CLICKHOUSE_USER=cli_user \
  -e CLICKHOUSE_PASSWORD=super-secret \
  -e CLICKHOUSE_DB=analytics \
  clickhouse/clickhouse-server:latest
```

### 0.3 Seed data (gives `init`/`generate` real tables to introspect)
```sql
-- run via: docker exec -i hq-ch clickhouse-client --user cli_user --password super-secret < seed.sql
CREATE DATABASE IF NOT EXISTS analytics;

CREATE TABLE analytics.users (
  id          String,
  email       String,
  status      String,
  created_at  DateTime
) ENGINE = MergeTree ORDER BY (created_at, id);

CREATE TABLE analytics.events (
  id          String,
  user_id     String,
  name        String,
  created_at  DateTime,
  value       Float64
) ENGINE = MergeTree ORDER BY (created_at, id);

CREATE TABLE analytics.orders (
  id          String,
  user_id     String,
  total       Decimal(18,2),
  created_at  DateTime
) ENGINE = MergeTree ORDER BY (created_at, id);

INSERT INTO analytics.users VALUES
  ('u1','a@x.com','active', now()), ('u2','b@x.com','inactive', now());
INSERT INTO analytics.events VALUES
  ('e1','u1','signup', now(), 1), ('e2','u1','purchase', now(), 42.5);
INSERT INTO analytics.orders VALUES
  ('o1','u1', 42.50, now());
```

### 0.4 Connection env vars
`CLICKHOUSE_URL` is preferred. Aliases the CLI also accepts: `CLICKHOUSE_HOST` (URL),
`CLICKHOUSE_USER`/`CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`.

```bash
export CLICKHOUSE_URL=http://localhost:8123
export CLICKHOUSE_DATABASE=analytics
export CLICKHOUSE_USERNAME=cli_user
export CLICKHOUSE_PASSWORD=super-secret
```

### 0.5 Useful test-only env vars
- `HYPEQUERY_SKIP_INSTALL=1` — skips the automatic `npm/pnpm/yarn/bun add` step in `init`. Set it to make `init` fast and deterministic when network/registry isn't desired, then install manually. (Undocumented; verify it works — see T1.7.)

### 0.6 How to invoke the CLI under test
Pick ONE and note it in the report:
- Published: `npx @hypequery/cli@<version> <cmd>`
- Local build (this repo): `node /path/to/packages/cli/dist/bin/cli.js <cmd>` after `pnpm --filter @hypequery/cli build`
- Linked: `npm install -D @hypequery/cli` then `npx hypequery <cmd>`

Throughout this doc, `hq` = whichever invocation you chose.

---

## 1. `hypequery init`

Real-world goal: "scaffold an analytics layer in my project."

**Actual options (from source):**
`--path <dir>`, `--style <queries|datasets>`, `--auth <none|context>`,
`--all-tables`, `--tables <names>`, `--exclude-tables <names>`,
`--no-example`, `--no-interactive`, `--force`, `--skip-connection`.
(There is **no** `--database` flag on `init`, despite the docs.)

### T1.1 — Interactive happy path (queries style)
**Pre:** empty repo with a `package.json` (`npm init -y`), env vars **unset** (force prompts).
**Run:** `hq init`
**Walk the prompts:** ClickHouse URL → database → username → password → output dir (`analytics/`) → style (`Query builder routes`) → "Generate an example query?" yes → pick `users`.
**Expect:**
- Spinner: `Testing connection...` → `Connected successfully (3 tables found)`.
- Files created at repo root: `.env`, `.gitignore` (created or updated).
- Files in `analytics/`: `schema.ts` (real introspected types, not placeholder), `client.ts`, `queries.ts`.
- `queries.ts` contains a `usersQuery` example selecting from `users`, exports `api`, and `api.route('/metrics/usersQuery', ...)`.
- Dependency install runs: `@hypequery/clickhouse`, `@hypequery/serve`, `zod` added to `package.json` (unless already present / `HYPEQUERY_SKIP_INSTALL=1`).
- `.env` has `CLICKHOUSE_URL/DATABASE/USERNAME/PASSWORD` populated.
- Final "Setup complete!" with a "Try your first query" snippet and `npx hypequery dev` next step.
**Pass:** all files exist, `schema.ts` contains interfaces for `users`/`events`/`orders`, `queries.ts` typechecks.

### T1.2 — Non-interactive from env vars
**Pre:** env vars from §0.4 set; fresh dir with `package.json`.
**Run:** `hq init --no-interactive --path src/analytics`
**Expect:** no prompts; connects using env; writes `src/analytics/{schema,client,queries}.ts`; `.env` updated/created; **no example query** is generated in non-interactive mode (example generation is gated on interactivity), so `queries.ts` uses the `exampleMetric` fallback. Exit 0.
**Pass:** files under `src/analytics/`; command never blocks on input.

### T1.3 — Non-interactive with missing env var (error path)
**Pre:** unset `CLICKHOUSE_DATABASE`.
**Run:** `hq init --no-interactive`
**Expect:** throws `Missing CLICKHOUSE_DATABASE. Provide ClickHouse connection info via environment variables when using --no-interactive.`; exit code 1; no files written.

### T1.4 — Non-interactive with bad credentials (error path)
**Pre:** set `CLICKHOUSE_PASSWORD=wrong`.
**Run:** `hq init --no-interactive`
**Expect:** `Testing connection...` → `Connection failed`, then thrown error `Failed to connect to ClickHouse in non-interactive mode...`; exit 1.

### T1.5 — `--skip-connection` (scaffold without DB)
**Pre:** any env (even invalid).
**Run:** `hq init --no-interactive --skip-connection --path analytics`
**Expect:** prints `Skipping database connection test (requested).`; writes a **placeholder** `schema.ts` (contains `export interface IntrospectedSchema {}` and a "Run 'npx hypequery generate'" comment); `client.ts`/`queries.ts` created; example query is **not** generated (needs a valid connection). Exit 0.

### T1.6 — Datasets style + table selection
**Pre:** valid connection.
**Run:** `hq init --no-interactive --style datasets --tables users,orders --path analytics`
**Expect:** creates `analytics/datasets.ts` (generated from `users` + `orders`, not the placeholder) and `analytics/api.ts` (uses `createAPI({ queryBuilder: db, datasets })`). Also installs `@hypequery/datasets` in addition to clickhouse/serve/zod. "Setup complete!" next-step references dev server.
**Variants:**
- `--style datasets --all-tables` → datasets generated for all 3 tables.
- `--style datasets` with no `--tables`/`--all-tables` in non-interactive → writes the **placeholder** `datasets.ts` and prints `Skipped dataset generation. Run hypequery generate:datasets ...`.
- Interactive datasets: confirm the multiselect "Which tables should we scaffold as datasets?" appears.

### T1.7 — Auth scaffold mode
**Run:** `hq init --no-interactive --auth context --path analytics`
**Expect:** generated `queries.ts`/`api.ts` import `fromContext` and include host/user auth helper scaffolding. Invalid value `--auth bogus` must throw `Unsupported auth mode "bogus". Use "none" or "context".` (exit 1).

### T1.8 — Existing files / `--force`
**Pre:** run T1.1 once so `analytics/` exists.
**Run again interactive:** `hq init` (same path) → expect `Files already exist` warning + overwrite confirm; declining prints `Setup cancelled` and exits 0 without changes.
**Run:** `hq init --no-interactive` over existing files → overwrite confirm defaults to **false** in non-interactive, so it cancels (exit 0, files unchanged).
**Run:** `hq init --no-interactive --force --path analytics` → overwrites without asking.

### T1.9 — Skip install via env
**Run:** `HYPEQUERY_SKIP_INSTALL=1 hq init --no-interactive --skip-connection --path analytics` in a dir with `package.json`.
**Expect:** no `npm/pnpm/... add` subprocess runs; no scaffold deps added to `package.json`. (Confirms the documented-nowhere escape hatch.)

### T1.10 — No `package.json`
**Pre:** dir without `package.json`.
**Run:** `hq init --no-interactive --skip-connection`
**Expect:** warning `package.json not found. Install @hypequery/clickhouse, @hypequery/serve, and zod manually.`; files still scaffolded; exit 0.

---

## 2. `hypequery generate` (and `generate:types`)

Real-world goal: "my ClickHouse schema changed — refresh my types."
`generate:types` is an alias that only differs in the header label (`hypequery generate:types`).

**Actual options:** `-o, --output <path>`, `--path <path>`, `--tables <names>`, `--database <type>`.

### T2.1 — Generate into existing project
**Pre:** project from T1.1 (so `analytics/schema.ts` exists), env vars set.
**Run:** `hq generate`
**Expect:** header `hypequery generate`; spinner `Connecting to clickhouse...` → `Connected to ClickHouse`; `Found 3 tables`; `Generating types...` → `Generated types for 3 tables`; `Updated analytics/schema.ts`. Auto-discovers existing `analytics/schema.ts` as output. Exit 0.
**Pass:** `schema.ts` regenerated with interfaces for all 3 tables.

### T2.2 — Greenfield (no existing schema)
**Pre:** empty dir, only `.env`/env vars, no `analytics/`.
**Run:** `hq generate`
**Expect:** defaults output to `analytics/schema.ts` (creates the dir). Exit 0.

### T2.3 — `--output` explicit path
**Run:** `hq generate --output types/ch.ts` → writes `types/ch.ts`; `Updated types/ch.ts`.

### T2.4 — `--path` derives `<path>/schema.ts`
**Run:** `hq generate --path src/analytics` → writes `src/analytics/schema.ts`. (This flag is **undocumented** — verify it works.)

### T2.5 — `--tables` subset
**Run:** `hq generate --tables users,events`
**Expect:** only `users` and `events` interfaces present in output; `orders` absent. Note the `Found N tables` count reflects total tables, while generation is restricted.

### T2.6 — Connection error guidance
**Pre:** point `CLICKHOUSE_URL` at a dead port, e.g. `http://localhost:9` .
**Run:** `hq generate`
**Expect:** spinner fails `Failed to generate types`; prints `ECONNREFUSED`-specific hints ("ClickHouse is not running", shows `CLICKHOUSE_URL=...`, links troubleshooting). Exit 1. Also spot-check an auth failure (wrong password) prints the "Authentication failed" branch with masked password.

### T2.7 — `generate:types` alias
**Run:** `hq generate:types --output analytics/schema.ts`
**Expect:** identical behavior to T2.1 except header reads `hypequery generate:types`.

---

## 3. `hypequery generate:datasets`

Real-world goal: "scaffold a semantic dataset layer from my schema."
**Actual options:** `-o, --output <path>`, `--path <path>`, `--tables <names>`, `--exclude-tables <names>`.
(**This entire command is undocumented in the CLI reference** — verify it works.)

### T3.1 — Default output
**Pre:** valid connection; ensure `@hypequery/datasets` resolvable (run from a project that installed it, or after T1.6).
**Run:** `hq generate:datasets`
**Expect:** header `hypequery generate datasets`; `Connected to ClickHouse`; `Found 3 tables`; `Generated dataset definitions for 3 tables`; `Created src/datasets/generated.ts` (note default is `src/datasets/generated.ts`, NOT `analytics/`). Prints "Next steps" + an example-usage block. Exit 0.

### T3.2 — `--path` and `--output`
- `hq generate:datasets --path analytics` → writes `analytics/datasets.ts`.
- `hq generate:datasets --output ds/all.ts` → writes `ds/all.ts`.

### T3.3 — `--tables` / `--exclude-tables`
- `hq generate:datasets --tables orders` → only `orders` dataset; success line says `for 1 tables`.
- `hq generate:datasets --exclude-tables events` → `users` + `orders` only.

### T3.4 — No matching tables
**Run:** `hq generate:datasets --tables does_not_exist`
**Expect:** failure path; if generator reports "No tables found", CLI prints `No tables match the specified criteria` + suggestion. Exit 1.

---

## 4. `hypequery dev [file]`

Real-world goal: "run my queries locally with docs + hot reload."
**Actual options:** `-p, --port <port>`, `-h, --hostname <host>`, `--no-watch`,
`--no-cache`, `--cache <provider>`, `--redis-url <url>`, `--open`, `--cors`,
`--path <path>`, `-q, --quiet`.
> ⚠️ `--cache`, `--redis-url`, and `--cors` are parsed but **not forwarded** to the
> dev server (only `port`/`hostname`/`quiet` are passed to `serveDev`). Treat these
> as no-ops and flag in the report (see Appendix A.4).

### T4.1 — Auto-detect entry + start (queries style)
**Pre:** project from T1.1 (`analytics/queries.ts` exists), deps installed, env set. `dev` is a long-running process — run it backgrounded and poll.
**Run:** `hq dev`
**Expect (stdout):**
- `Found: analytics/queries.ts`
- spinners `Compiling queries...` → `Compiled queries`, `Connecting to ClickHouse...` → `Connected to ClickHouse (3 tables)`
- `Registered 1 query`
- a boxed block listing `Docs: http://localhost:4000/docs` and `OpenAPI: http://localhost:4000/openapi.json`
- `Ready in <n>ms`, then `Watching for changes...`
**Verify server:**
```bash
curl -s http://localhost:4000/openapi.json | head
curl -s http://localhost:4000/docs | head
# execute the example route:
curl -s http://localhost:4000/metrics/usersQuery
```
**Pass:** server responds; OpenAPI JSON returned; the route returns rows from `users`.
**Teardown:** send SIGINT; expect `Shutting down dev server...` and clean exit 0.

### T4.2 — Explicit file argument
**Run:** `hq dev analytics/queries.ts` → `Found: analytics/queries.ts`, server starts as T4.1.

### T4.3 — `--path` directory resolution
**Run:** `hq dev --path analytics`
**Expect:** resolves `analytics/api.ts` if present, else `analytics/queries.ts`. (Datasets-style projects from T1.6 have `api.ts`; queries-style have `queries.ts`.)

### T4.4 — Datasets-style entry
**Pre:** project from T1.6 (has `analytics/api.ts` using `createAPI`).
**Run:** `hq dev --path analytics` (or `hq dev analytics/api.ts`)
**Expect:** loads the `createAPI` module successfully; docs/openapi served; dataset routes available.

### T4.5 — Custom port + hostname
**Run:** `hq dev --port 3000` then `--port 3000 -h 127.0.0.1`
**Expect:** box shows `http://localhost:3000/...` (hostname defaults to `localhost`; with `-h 127.0.0.1` the URL reflects it). `curl http://127.0.0.1:3000/openapi.json` works.

### T4.6 — `--open`
**Run:** `hq dev --open`
**Expect:** attempts to open default browser to the base URL; prints `Opened http://localhost:4000 in browser` (or, if no browser/headless, the warn fallback `Could not open browser automatically` + `Visit:` — must not crash).

### T4.7 — `--no-watch`
**Run:** `hq dev --no-watch`
**Expect:** starts server once, **no** `Watching for changes...` line, no file watcher. On a load error in this mode it exits 1 (vs. staying alive in watch mode).

### T4.8 — Hot reload
**Pre:** `hq dev` running (watch on).
**Action:** edit `analytics/queries.ts` (add a second query, save).
**Expect:** `File changed, restarting...`, server restarts, `Registered 2 queries`. (Watcher is recursive on the entry file's directory, debounced ~100ms, `.ts`/`.js` only.)

### T4.9 — `--quiet`
**Run:** `hq dev --quiet`
**Expect:** suppresses the "Query execution stats will appear below..." line; server still starts.

### T4.10 — No entry file found (error path)
**Pre:** empty dir.
**Run:** `hq dev`
**Expect:** `Could not find hypequery API file`, lists expected locations (`hypequery.ts`, `analytics/api.ts`, `src/analytics/api.ts`, `api.ts`, `src/api.ts`, `analytics/queries.ts`, `src/analytics/queries.ts`), asks "Did you run 'hypequery init'?", and shows `hypequery dev ./path/to/api.ts`. Exit 1.

### T4.11 — File exists but bad/no `api` export (error path)
**Pre:** create `bad.ts` exporting `export const foo = 1;` (no `api`).
**Run:** `hq dev bad.ts`
**Expect:** `Invalid API module: bad.ts`, `The module must export a hypequery API as 'api'.`, `Found exports: foo`, and an "Expected format" block showing both `initServe`/`serve` and `createAPI` datasets forms. Exit 1.

### T4.12 — Nonexistent explicit file
**Run:** `hq dev nope.ts`
**Expect:** since the path doesn't resolve, falls through to the "Could not find hypequery API file" not-found error (T4.10), exit 1.

### T4.13 — TypeScript entry without a TS runner
**Pre:** queries-style project, no `tsx`/`ts-node` installed.
**Run:** `hq dev analytics/queries.ts`
**Expect:** CLI bundles TS in-process via esbuild (writes temp bundle under `.hypequery/tmp/` or OS temp, cleaned on exit). Works with no extra runtime. Confirm `.hypequery/tmp/` is cleaned after SIGINT.

### T4.14 — DB unreachable but file valid
**Pre:** valid `queries.ts`, but `CLICKHOUSE_URL` pointed at dead port.
**Run:** `hq dev`
**Expect:** `Compiled queries`, then `Could not connect to ClickHouse` warn with `Reason: ...` — server **still starts** (table count is best-effort/optional). Queries that hit the DB will error at request time.

---

## 5. Global / meta

### T5.1 — `hypequery --help` and `hypequery help`
**Expect:** lists `init`, `dev`, `generate`, `generate:types`, `generate:datasets`, `help`; the custom Examples block (`hypequery init`, `hypequery dev`, `hypequery dev --port 3000`, `hypequery generate --output ...`, `hypequery generate:types ...`, `hypequery generate:datasets`) and `Docs: https://hypequery.com/docs`.

### T5.2 — `hypequery help <command>`
**Run:** `hq help dev`, `hq help generate`, `hq help bogus`.
**Expect:** valid commands print their option help; `bogus` prints `Unknown command: bogus`, exit 1.

### T5.3 — `hypequery --version`
**Run:** `hq --version`
**Expect:** prints the real package version from `package.json` (currently `1.1.2`), read at runtime via `import.meta.url`. **Pass:** output matches the installed `@hypequery/cli` version. (Previously hardcoded to `0.0.1` — now fixed.)

### T5.4 — Unknown command/flag
**Run:** `hq frobnicate`, `hq init --nonsense`.
**Expect:** commander error + nonzero exit; no partial scaffolding.

### T5.5 — `.env` auto-loading
**Pre:** a `.env` (no shell exports) with valid creds.
**Run:** `hq generate`
**Expect:** the bin loads `.env` automatically (via `@dotenvx/dotenvx` if present, else `dotenv`), so generate connects without exported vars.

---

## 6. End-to-end user journeys (integration)

Run these as ordered scripts; they're the highest-signal "does the product work" checks.

### J1 — Quick Start Route 2 (reusable queries + serve)
1. `npm init -y`
2. `npm install @hypequery/clickhouse @hypequery/serve zod && npm install -D @hypequery/cli`
3. `hq init --no-interactive` (env set) → scaffolds `analytics/`
4. Edit `analytics/queries.ts` to add an `activeUsers` query with zod input/output (per quick-start docs).
5. `hq dev analytics/queries.ts`
6. `curl -X POST http://localhost:4000/<route> -H 'Content-Type: application/json' -d '{"limit":10}'` → rows returned.
**Pass:** full loop works; types compile; route returns live data.

### J2 — Schema-change refresh loop
1. From J1's project, `ALTER TABLE analytics.users ADD COLUMN country String`.
2. `hq generate`
3. **Pass:** `analytics/schema.ts` now includes `country` on the `users` interface.

### J3 — Datasets semantic layer
1. `hq init --no-interactive --style datasets --all-tables --path analytics`
2. `hq dev --path analytics` → `createAPI` server boots, dataset routes served.
3. Modify a measure, save → hot reload picks it up (T4.8).
**Pass:** datasets API serves and reloads.

### J4 — Multi-package-manager scaffold (optional)
Repeat T1.1 once each under `pnpm`/`yarn`/`bun` projects; confirm the CLI uses the matching install command and `Installed ...` succeeds.

---

## 7. Reporting template

For each test ID, record: **command run**, **exit code**, **key stdout lines**,
**files created/changed**, **PASS/FAIL**, and notes. Call out any deviation from the
expected behavior above, and separately confirm/deny each item in Appendix A.

---

## Appendix A — Docs accuracy report (findings, as of this spec)

Source compared: `website-next/docs/reference/api/cli.mdx` and `packages/cli/README.md`
vs. `packages/cli/src/**`. **Fix the docs and/or the code for each:**

**A.1 `init --database` is documented but does not exist.**
`cli.mdx` lists `--database <type>` under `hypequery init`. The `init` command defines no such option (only `generate`/`generate:types`/`generate:datasets` accept `--database`). → Remove from init docs.

**A.2 Real `init` options are undocumented.**
Missing from docs: `--style <queries|datasets>`, `--auth <none|context>`,
`--all-tables`, `--tables <names>`, `--exclude-tables <names>`. The entire
**datasets scaffold flow** is therefore undocumented at the CLI-reference level.

**A.3 Whole commands are undocumented.**
`generate:types`, `generate:datasets`, and `help [command]` do not appear in the CLI
reference (the "Commands at a glance" table only shows `init`, `dev`, `generate`).

**A.4 `dev` options: undocumented + non-functional.**
- Undocumented but real: `--path <path>`, `--cors`, `--cache <provider>`, `--no-cache`, `--redis-url <url>`.
- **Non-functional:** `--cache`, `--redis-url`, `--cors` are parsed into `DevOptions` but `devCommand` only forwards `port`/`hostname`/`quiet` to `serveDev`. They currently do nothing. Either wire them through or remove them. (README advertises `--cache`/`--cors` as if functional.)

**A.5 `generate --path` is undocumented.**
`generate`/`generate:types` accept `--path <dir>` (derives `<dir>/schema.ts`); docs omit it. Docs' description of the default `--output` ("Defaults to your existing analytics/schema.ts or analytics/schema.ts if not found") is also muddled — actual logic searches `analytics/schema.ts`, `src/analytics/schema.ts`, `schema.ts`, `src/schema.ts`, falling back to `analytics/schema.ts`.

**A.6 `--version` (FIXED).**
`cli.ts` previously hardcoded `.version('0.0.1')`. Now reads `version` from `package.json` at runtime, so `--version` reports the real installed version. No action needed; T5.3 verifies it.

**A.7 `dev` default file detection list is incomplete/misordered in docs.**
Docs say it defaults to `analytics/queries.ts`, `src/analytics/queries.ts`, or nearest `hypequery.ts`. Actual search order: `hypequery.ts`, `analytics/api.ts`, `src/analytics/api.ts`, `api.ts`, `src/api.ts`, `analytics/queries.ts`, `src/analytics/queries.ts`, `queries.ts`, `src/queries.ts` — i.e. `api.ts` variants are checked **before** `queries.ts`.

**A.8 `init` installs `zod` (+ `@hypequery/datasets` for datasets style).**
`cli.mdx` says it "installs the scaffold dependencies" but doesn't name them; README does mention `zod`. Worth stating explicitly, plus the `HYPEQUERY_SKIP_INSTALL=1` escape hatch (currently undocumented).

**A.9 Accepted entry-export forms.**
`dev` accepts an `api` **or** `default` export and validates `typeof api.handler === 'function'`. Docs' troubleshooting only shows the `initServe`/`serve` form; the `createAPI` datasets form is equally valid (the error message itself shows both).

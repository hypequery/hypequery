# hypequery Gateway Contract v0

Date: 2026-07-05
Status: draft (normative for `@hypequery/playground` local gateway and `@hypequery/studio` UI;
the future Cloud control plane implements the same contract)
Companion: `plans/dev-playground-design.md`

## Principles

- **One frontend, N gateways.** `@hypequery/studio` renders against a single
  `gatewayBaseUrl`; local dev and Cloud differ only in that URL and in advertised
  capabilities. The UI never imports server code.
- **Additive-only within 0.x.** New fields, event types, and capabilities may appear at
  any time; nothing existing may be removed or change meaning. UI must tolerate unknown
  fields, unknown SSE event types, and unknown capabilities.
- **Optionality is a capability, never a version bump.**
- **Execution goes through the real serve pipeline** (auth, tenant isolation,
  rate-limit, cache) — the gateway has no side door.

## Transport & auth

- HTTP + SSE under one base path. Local: `http://localhost:PORT/__dev`. Cloud: wherever
  the control plane mounts it.
- Auth: `Authorization: Bearer <token>` everywhere. Local: requests from loopback need
  no token; any non-loopback request requires `HYPEQUERY_DEV_TOKEN` (gateway refuses to
  answer otherwise). Cloud: session JWT. UI handles 401 uniformly.
- CORS: same-origin by default. An explicit origin allowlist may be configured; the
  wildcard `*` is forbidden by this contract.

## Endpoints

### `GET {base}/meta` — discovery (required)

```json
{
  "contractVersion": "0.1",
  "mode": "local",                        // "local" | "cloud"
  "serverVersion": "…",
  "capabilities": ["registry", "execute", "history", "events"],
  "project": { "name": "…" },
  "clickhouse": { "connected": true, "database": "…", "host": "…?" }
}
```

Capability strings defined so far: `registry`, `execute`, `history`, `events`, `cache`,
`schema`, `ai`. The UI renders only what is advertised.

### `GET {base}/registry` — endpoint catalog (capability `registry`)

Source of truth: serve's `describe()` (`ToolkitDescription`), which includes semantic
dataset/metric routes. Entries: `key`, `path`, `method`, `name?`, `description?`,
`tags[]`, `visibility`, `requiresAuth`, `requiresTenant?`, `requiredRoles?`,
`requiredScopes?`, `inputSchema?` (JSON Schema), `outputSchema?`, `custom?`.

### `POST {base}/execute` (capability `execute`)

Request: `{ "key": string, "input?": unknown, "context?": { "tenantId?": string, "roles?": string[] } }`
(`context` is the dev auth-context picker; ignored or rejected in Cloud mode).

Response: `{ "queryId", "success": true, "result", "sql?", "durationMs", "cache?": { "status", "key?", "ageMs?" } }`
or typed error `{ "success": false, "error": { "type", "message", "details?" } }` with an
appropriate HTTP status (400 validation, 401/403 auth, 500 execution). `queryId` joins
to `/history/:queryId`.

### History (capability `history`)

```
GET    {base}/history?status&endpointKey&search&limit&offset  → { queries: [...], total }
GET    {base}/history/:queryId                                → entry incl. generated SQL,
                                                                input, timing breakdown,
                                                                tenantId, cache fields
DELETE {base}/history                                         → { cleared }
```

(Named `/history`, not the donor's `/queries` — `/registry` owns "what exists".)

### `GET {base}/events` — SSE (capability `events`)

Event types: `query:started`, `query:completed`, `query:error` (payload = the history
entry, incl. generated SQL), `cache:updated`. Note: `query:completed` — the donor UI's
`query:complete` was a bug; this contract settles the name. Heartbeat comments every
30s. `Last-Event-ID` replay is NOT part of v0 (donor plumbing was dead code — deleted);
clients refetch history on reconnect. May become a capability later.

### Cache (capability `cache`)

`GET {base}/cache` → stats snapshot; `POST {base}/cache/clear` → `{ cleared }`.

### `GET {base}/schema` (capability `schema`)

ClickHouse introspection: databases → tables → columns/types, from
`system.tables`/`system.columns`.

### `POST {base}/ai/chat` (capability `ai`)

SSE-streamed chat. Tool calls are constrained to registry entries; the gateway executes
them via the same path as `/execute` and tags resulting history entries `ai`. Raw SQL
execution is not expressible in this contract.

## Asset serving (local mode, informative — not part of the contract)

The local gateway also serves the studio's prebuilt dist same-origin: `GET /__dev` →
HTML shell, `GET /__dev/assets/*` → static assets. Cloud serves the UI its own way; the
contract governs only the API above.

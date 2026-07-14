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
- **Payload semantics defer to the security protocol** (added 2026-07-14). This
  contract owns the dev transport: paths, auth, SSE mechanics, capability negotiation.
  Payload semantics that Cloud must share — canonical value encoding, error codes,
  compiled-query/event envelopes — are owned by `specs/security-protocol` as they are
  accepted there; where the two overlap, the protocol is normative. This contract must
  not define competing rules for those surfaces.

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
`cache:clear`, `schema`, `ai`, `telemetry`. The UI renders only what is advertised.
`x:y` strings are sub-capabilities: they refine a parent and are only meaningful when
the parent is also advertised.

### `GET {base}/registry` — endpoint catalog (capability `registry`)

Source of truth: serve's `describe()` (`ToolkitDescription`), which includes semantic
dataset/metric routes. Entries: `key`, `path`, `method`, `name?`, `description?`,
`tags[]`, `visibility`, `requiresAuth`, `requiresTenant?`, `requiredRoles?`,
`requiredScopes?`, `inputSchema?` (JSON Schema), `outputSchema?`, `custom?`.

### `POST {base}/execute` (capability `execute`)

Request: `{ "key": string, "input?": unknown, "context?": { "tenantId?": string, "roles?": string[] } }`

`context` is the dev auth-context picker (local mode only). A gateway that does not
support it — Cloud mode, where identity comes from the session — MUST reject a request
carrying `context` with `400` and `error.type: "context_not_allowed"`; silently
ignoring it is forbidden, since a developer simulating a tenant must never get
un-scoped results labelled as scoped ones. The UI hides the context picker when
`mode` is not `"local"`.

Response: `{ "queryId", "success": true, "result", "sql?", "durationMs", "cache?": { "status", "key?", "ageMs?" } }`
or typed error `{ "success": false, "error": { "type", "message", "details?" } }` with an
appropriate HTTP status (400 validation, 401/403 auth, 500 execution). `queryId` joins
to `/history/:queryId`.

`result` is plain JSON in v0, which cannot faithfully represent Int64/UInt64/Decimal
precision, DateTime64 zones, or ClickHouse Map ordering. A future capability (working
name `values-v1`) will let clients request results as protocol tagged values
(`specs/security-protocol` RFC 0001) — additive, no v0 field changes.

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

Event types: `query:started` (payload `{ "queryId", "key", "startedAt" }` — the
`queryId` correlates the in-flight query with the history entry that arrives on
completion), `query:completed`, `query:error` (payload = the history entry, incl.
generated SQL), `cache:updated`. Note: `query:completed` — the donor UI's
`query:complete` was a bug; this contract settles the name. Heartbeat comments every
30s. `Last-Event-ID` replay is NOT part of v0 (donor plumbing was dead code — deleted);
clients refetch history on reconnect. May become a capability later.

### Cache (capability `cache`)

```
GET  {base}/cache        → { "layers": [ { "layer": "semantic" | "builder", "stats": {…} }, … ] }
POST {base}/cache/clear  → { cleared }    body: { "layer?": string } — omit to clear all
```

Stats are reported per cache layer (see the design doc's "Cache architecture": the
semantic query cache and the query-builder cache are the only result caches; there is
no serve-layer response cache). New layer ids are additive.

Clear support is signalled by the `cache:clear` sub-capability, advertised only when a
real cache is wired for clearing. A gateway without wired cache observability may still
advertise `cache` (deriving approximate hit/miss stats from query history) but must
omit `cache:clear`, and the UI must not render clear affordances without it.
`/cache/clear` on such a gateway returns 503 — defense against clients that ignore
capabilities, not a state the UI should ever trigger.

### `GET {base}/schema` (capability `schema`)

ClickHouse introspection: databases → tables → columns/types, from
`system.tables`/`system.columns`.

### `POST {base}/ai/chat` (capability `ai`)

SSE-streamed chat. Tool calls are constrained to registry entries; the gateway executes
them via the same path as `/execute` and tags resulting history entries `ai`. Raw SQL
execution is not expressible in this contract.

### Telemetry (capability `telemetry`)

```
GET  {base}/telemetry  → { "enabled": boolean }
POST {base}/telemetry  → 204        body: { "events": [ { "name": string, "props?": object } ] }
```

`GET` reports the effective telemetry state for transparency (reflects the opt-out
switches — see the design doc's Telemetry section for the policy). `POST` is the
same-origin beacon the studio UI sends its events to; the browser never contacts a
third party. The gateway validates `name` against its event allowlist and sanitizes
`props` server-side; unknown events and disallowed props are dropped silently. The
response is always `204` regardless of enabled state or dropped events — the beacon is
fire-and-forget and must never surface errors to the UI. When telemetry is disabled,
`POST` accepts and discards. Gateways without telemetry (e.g. Cloud) omit the
capability, and the UI must not send beacons without it.

## Asset serving (local mode, informative — not part of the contract)

The local gateway also serves the studio's prebuilt dist same-origin: `GET /__dev` →
HTML shell, `GET /__dev/assets/*` → static assets. Cloud serves the UI its own way; the
contract governs only the API above.

# Hypequery Python (Datasets + Serve) — PR-Level Implementation Plan

**Status:** Draft for review — activates the deferred PY train as a product
effort  
**Drafted:** 30 July 2026  
**Goal:** A supported Python SDK for dataset authoring/execution and a strict
FastAPI serving layer, expanding Hypequery beyond TypeScript teams  
**Source documents:** `PYTHON_SECURITY_HARDENING_ROADMAP.md`,
`CLOUD_BETA_2026_PR_LEVEL_PLAN.md` (PY-01…PY-12 skeleton),
`specs/security-protocol/` (RFC 0001–0012 and fixtures)

## Sequencing note — supersedes the 22 July deferral

The 22 July 2026 decision deferred production Python until after Cloud usage,
allowing only a 3–5 day protocol probe. This plan reverses that deferral for a
product reason: market expansion beyond TypeScript teams. It preserves the two
non-negotiable constraints from the security roadmap:

1. **Python implements the protocol; it never ports TypeScript internals.**
   No port of `escapeValue()`, no second canonicalisation, no independent SQL
   rendering. Every family is proven against the shared fixtures via the
   conformance runner.
2. **Python does not block Cloud.** Trains PY-A/PY-B/PY-C consume frozen
   protocol artifacts; they add no Cloud dependency. Where Python needs a
   behavior TypeScript has not shipped yet (metadata split, metadata-only
   events), Python implements the *protocol-correct* behavior first and the
   TypeScript parity fix is tracked as a repo-side prerequisite, not blocked on.

If accepted, record this override in both source roadmap documents.

## What already exists (assessed 30 July 2026)

The position is materially better than the July roadmap docs assume:

- `specs/security-protocol/rfc/` — RFCs 0001–0012 cover the tagged value
  model, portable identifiers, dataset expressions, query schemas, query
  implementations, deployment contract/bundle/release envelopes, capability
  and metadata security, compiled query/error/cancellation, query events and
  diagnostics, and cross-language conformance. **All are `Proposed`, none
  `Accepted`.**
- `specs/security-protocol/fixtures/` — 12 fixture families including fuzz
  seeds, each with success/rejection (and where relevant identity) corpora.
- `packages/protocol-conformance` — a working cross-language runner. Adapters
  are NDJSON-over-stdio processes; the README already documents
  `hypequery-protocol-conformance run -- python -m my_impl.adapter`.
- `packages/protocol` — TypeScript reference implementation and reference
  adapter.
- `packages/datasets` — the authoring surface to mirror: `dataset`,
  `dimension`, `measure`, relationships (`belongsTo`/`hasMany`/`hasOne`),
  aggregations (`sum`…`variance`), formulas, query helpers, registry, catalog,
  semantic contract serialization/hashing, `buildProtocolDatasetContract`,
  and the R1A-07 SQL-portability compiler.
- `packages/serve` — router, endpoints, auth, CORS, rate limit, OpenAPI/docs,
  adapters, semantic endpoints, `buildProtocolDeploymentContract`,
  `zodToProtocolSchema`.

Consequence: the original PY-PROBE-01 (3–5 day probe) is no longer a
stop-and-decide gate. It becomes the first two conformance PRs of a continuing
train.

## Non-goals

- No Python query-builder port of `@hypequery/clickhouse`. The Python surface
  is datasets + serve; raw-SQL power users are served by the trusted-local
  escape hatch, marked non-portable, exactly as in TypeScript.
- No Python React/client codegen in this plan.
- No Python MCP server in this plan (follow-up once serve is stable).
- No Cloud dependency: Cloud accepts bundles, and bundles are
  language-neutral. Python-authored Cloud deployment is a later qualification
  gate (PYE-06), not a build dependency.
- No streaming/large exports until the shared streaming contract exists.

## Repository and packaging decisions (proposed defaults)

- **Layout:** `python/` at the monorepo root, managed with `uv` +
  `hatchling`; `ruff` + `mypy --strict` + `pytest`; Python 3.11–3.14 matrix.
  CI runs it as a separate job alongside the pnpm/Turbo pipeline.
- **Distribution:** one PyPI distribution, **`hypequery`**, with extras:
  `hypequery[clickhouse]` (adds `clickhouse-connect`) and
  `hypequery[fastapi]` (adds FastAPI/Starlette/Uvicorn floors). Internal
  module boundaries `hypequery.protocol`, `hypequery.datasets`,
  `hypequery.serve` enforce that definition-only use never imports FastAPI or
  the driver (import-linter contract in CI). Split into separate
  distributions only if a real consumer needs it.
- **Name reservation:** reserve `hypequery`, `hypequery-clickhouse`,
  `hypequery-datasets`, `hypequery-serve`, `hypequery-fastapi` on PyPI in
  week 1 (PYA-00) — before any public signal.
- **Versioning:** 0.x throughout this plan. Every published change still
  carries a changelog entry; the npm Changesets flow does not cover PyPI, so
  PYA-02 adds an equivalent release-notes + tagging flow.
- **API style:** Pythonic, not transliterated TypeScript. Keyword-only
  arguments, `snake_case`, Pydantic v2 strict models with `extra="forbid"`.
  Semantics (not spellings) must match: same catalog, same contract hash,
  same bundle bytes, same error codes.

## Pull-request rules

Identical to the Cloud plan rules, with Python-specific additions:

- One primary behavioral objective per PR; task ID in title and description.
- Handwritten logic ≤ ~500 lines excluding tests/fixtures/generated code.
- Every protocol-family PR lands its conformance adapter coverage in the same
  PR and turns that family's CI gate on permanently — a family, once green,
  can never be skipped again.
- No import-time I/O, no network/subprocess at import, no mutable global
  registration.
- Strict types end-to-end: `mypy --strict` clean; no `Any` in public
  signatures; no implicit Pydantic coercion for identifiers, tenant values,
  or security-relevant fields.
- Never serialise functions, pickle, marshal, or arbitrary objects into any
  artifact; bundles are strict JSON only.
- No f-string/`%`/`.format()` interpolation of values into SQL anywhere,
  including tests and examples.
- Errors are stable canonical codes; no tracebacks, paths, SQL, or driver
  detail in public errors.
- **Security review required** tags below mean human security review before
  merge.

## Dependency graph (trains)

```text
TS-side prerequisites (repo)          Python workspace
  TSP-01 RFC acceptance PRs ──┐         PYA-00 name reservation
  TSP-02 cache-key HMAC RFC   │         PYA-01 workspace + CI
  TSP-03 metadata-split parity│         PYA-02 release/tagging flow
                              ▼              │
                    PYA-03 canonical JSON + tagged values (RFC 0001)
                    PYA-04 portable identifiers (RFC 0002)
                    PYA-05 conformance CI gate
                              │
              ┌───────────────┴────────────────┐
              ▼                                ▼
   Train PY-B datasets core          Train PY-C execution
   PYB-01 definition models          PYC-01 clickhouse-connect executor
   PYB-02 expression AST (0003)      PYC-02 cancellation/deadlines (0010)
   PYB-03 sql-portability compiler   PYC-03 tenant capability (0009)
   PYB-04 query schemas (0004)       PYC-04 cache preimage + HMAC keys
   PYB-05 registry + catalog         PYC-05 events/diagnostics (0011)
   PYB-06 contract + hashing (0006)
   PYB-07 bundle envelope (0007/0008)
   PYB-08 planner → CompiledQuery (0005/0010)
   PYB-09 dataset client
              └───────────────┬────────────────┘
                              ▼
                     Train PY-D serve (FastAPI)
   PYD-01 router core + auth dependency
   PYD-02 dataset/metric endpoints
   PYD-03 HTTP security profile (CORS, limits, host, request-id)
   PYD-04 canonical errors + rate limiting
   PYD-05 discovery contract + docs policy
   PYD-06 ASGI production profile
   PYD-07 cross-implementation HTTP conformance
                              ▼
                     Train PY-E launch
   PYE-01 dev experience   PYE-02 examples   PYE-03 docs
   PYE-04 supply chain     PYE-05 beta       PYE-06 Cloud qualification
```

Trains PY-B and PY-C run in parallel after PY-A. PY-D starts once PYB-08 and
PYC-01 are merged.

---

## TypeScript-side prerequisites (repo PRs, not Python PRs)

### TSP-01 — RFC acceptance sweep
- **Scope:** Move RFCs 0001, 0002, 0003, 0004, 0005, 0012 from `Proposed` to
  `Accepted` (one PR per RFC or small groups), resolving open questions. The
  deployment/security families (0006–0011) may be accepted as PY-B/PY-C
  reach them, but 0001/0002/0012 must be accepted before PYA-03 merges.
- **Why:** A second-language implementation of a `Proposed` spec silently
  freezes it. Acceptance must be explicit, versioned, and reviewed.
- **Acceptance:** Status changed with reviewer sign-off; fixture manifests
  pinned; any fixture change from acceptance review lands here, not in
  Python PRs.

### TSP-02 — Cache-key HMAC specification
- **Scope:** RFC (or extension of RFC 0011) specifying canonical cache
  preimage → HMAC-SHA-256 → versioned opaque key, key scoping
  (project/environment), and fixtures. Addresses PYSEC-008.
- **Acceptance:** Fixture family `cache-keys-v1` with success/rejection
  corpora; TypeScript reference implementation in `@hypequery/protocol`.
- **Review:** Security review required.
- **Blocks:** PYC-04.

### TSP-03 — Public/privileged metadata split parity tracking
- **Scope:** Tracking issue + serve implementation of the RFC 0009 metadata
  split (public operational metadata vs privileged diagnostics) so
  TypeScript Serve and Python FastAPI expose the same shape. Python
  implements the RFC directly in PYD-02 and does not wait.
- **Acceptance:** Shared HTTP fixtures (PYD-07) pass against both once the
  serve change ships.

---

## Train PY-A — Foundation

### PYA-00 — PyPI/namespace reservation
- **Dependencies:** none. **Do first, quietly.**
- **Scope:** Reserve `hypequery` and sibling names on PyPI with minimal
  placeholder metadata pointing at the GitHub org; enable 2FA/trusted
  publishing on the PyPI project; reserve names used in docs/CI to prevent
  dependency confusion.
- **Acceptance:** Names owned by the org account; no functional code
  published; placeholder clearly marked pre-release.

### PYA-01 — Python workspace, toolchain, and CI
- **Dependencies:** none (parallel with TSP-01).
- **Scope:** `python/` root with `uv` workspace, `hatchling` build,
  `ruff`/`mypy --strict`/`pytest`/`import-linter` config, Python 3.11–3.14
  CI matrix, module skeleton (`hypequery.protocol/.datasets/.serve`),
  import-boundary contracts, no-import-time-I/O test.
- **Acceptance:** `pip install hypequery` (local build) imports with zero
  third-party runtime deps beyond Pydantic; `hypequery.serve` import fails
  cleanly without the `fastapi` extra; CI green on all versions; sdist/wheel
  contain no local paths or secrets (twine + content check script).

### PYA-02 — Python release and versioning flow
- **Dependencies:** PYA-01.
- **Scope:** Tag-driven release workflow (kept dormant until PYE-04 arms
  it), CHANGELOG convention, version single-sourcing, pre-release channel
  (`0.x.0.devN`) mirroring the npm canary idea without publishing yet.
- **Acceptance:** Dry-run release produces correct artifacts; publish step
  gated behind an environment that does not yet exist.

### PYA-03 — Canonical JSON and tagged value model (RFC 0001)
- **Dependencies:** TSP-01 (0001 accepted), PYA-01.
- **Scope:** RFC 8785 JCS encoder over the versioned tagged I-JSON value
  model; strict decode; Python-type mapping — arbitrary-precision `int`
  range-checked per ClickHouse type, `Decimal` never through binary float,
  timezone-aware datetimes only, NaN/Infinity rejected, bytes/UUID/enum/
  array/map/tuple limits enforced; stable failure codes.
- **Acceptance:** Conformance adapter passes `tagged-values-v1` success
  cases byte-identically and rejection cases code-identically, including
  the shared fuzz seeds. Property tests (hypothesis) for round-trip and
  range boundaries.
- **Review:** Security review required.

### PYA-04 — Portable identifiers (RFC 0002)
- **Dependencies:** TSP-01 (0002 accepted), PYA-03.
- **Scope:** Identifier grammar, normalization, safe identifier nodes;
  rejection of ambiguous/invalid Unicode per spec.
- **Acceptance:** `identifiers-v1` family fully green with fuzz seeds.
- **Review:** Security review required.

### PYA-05 — Conformance CI gate
- **Dependencies:** PYA-03, PYA-04.
- **Scope:** Repo CI job that builds the Python adapter and runs
  `hypequery-protocol-conformance run -- python -m hypequery.protocol.adapter`
  for all families the adapter declares; family list asserted in CI so a
  family can be added but never silently dropped; wired into `pnpm
  conformance` docs.
- **Acceptance:** CI fails if any declared family regresses; runbook for
  fixture updates covers both languages.

---

## Train PY-B — Datasets semantic core

### PYB-01 — Definition models
- **Dependencies:** PYA-04.
- **Scope:** `Dataset`, `dimension()`, `measure()`, relationships
  (`belongs_to`/`has_many`/`has_one`), aggregation helpers (`sum`, `count`,
  `count_distinct`, `avg`, `min`, `max`, `percentile`, `median`, `arg_max`,
  `arg_min`, `stddev`, `variance`), formula helpers, filter/order helpers —
  strict Pydantic models, `extra="forbid"`, callables resolved at definition
  time into data, never serialised.
- **Acceptance:** Unknown fields and implicit coercions rejected; a
  TypeScript-equivalent logical model constructs successfully; type-checked
  public API (mypy strict, `py.typed`).

### PYB-02 — Portable expression AST (RFC 0003)
- **Dependencies:** PYB-01, TSP-01 (0003 accepted).
- **Scope:** Expression AST model, validation limits (depth, node count),
  function allowlist; formula helpers compile to this AST.
- **Acceptance:** `expressions-v1` success/rejection fixtures green via the
  conformance adapter.
- **Review:** Security review required.

### PYB-03 — SQL-portability compiler
- **Dependencies:** PYB-02.
- **Scope:** Parity port of `compilePortableSqlExpression` semantics:
  parse the supported SQL expression surface into the portable AST, same
  issue codes, same limits; trusted-local raw SQL marked non-portable with
  the same diagnostics.
- **Acceptance:** `sql-portability-v1` fixtures green; non-portable fields
  produce matching incompatibility reports.
- **Review:** Security review required.

### PYB-04 — Query schemas (RFC 0004)
- **Dependencies:** PYB-01, TSP-01 (0004 accepted).
- **Scope:** Semantic query input model (dimensions/measures/filters/
  time grain/order/pagination), operator set parity
  (`SEMANTIC_FILTER_OPERATORS`, `SUPPORTED_TIME_GRAINS`), validation.
- **Acceptance:** `query-schemas-v1` fixtures green; invalid operators/
  types rejected with stable codes.

### PYB-05 — Registry and catalog
- **Dependencies:** PYB-04.
- **Scope:** `create_dataset_registry`, catalog generation
  (datasets/dimensions/measures/metrics/filters/relationships incl.
  queryable relationship fields) matching the TypeScript catalog shape.
- **Acceptance:** Catalog JSON for the shared example model is deep-equal
  to the TypeScript catalog fixture.

### PYB-06 — Semantic contract serialization and hashing (RFC 0006)
- **Dependencies:** PYB-05, RFC 0006 accepted.
- **Scope:** Contract serialization, stable JSON, contract hash; public
  discovery projection (no SQL/physical/secret fields).
- **Acceptance:** Contract hash byte-identical to TypeScript for the shared
  model; `deployments-v1` fixtures green; public projection fixture
  contains no privileged fields.
- **Review:** Security review required.

### PYB-07 — Deployment bundle and release envelopes (RFC 0007/0008)
- **Dependencies:** PYB-06, RFCs 0007/0008 accepted.
- **Scope:** Deterministic bundle generation from Python definitions;
  release envelope; size/count/depth/identifier limits enforced.
- **Acceptance:** **Byte-identical** TypeScript/Python bundles for the
  supported surface (`deployment-bundles-v1`/`deployment-releases-v1`
  identity fixtures); portability diagnostics match. **Gate: this parity is
  a hard precondition for PYB-08 and everything in PY-D.**
- **Review:** Security review required.

### PYB-08 — Planner and CompiledQuery (RFC 0005/0010)
- **Dependencies:** PYB-07, RFCs 0005/0010 accepted.
- **Scope:** Semantic planner (grouping, time grain, relationships, joins
  with tenant-predicate propagation, metrics, order/limit/offset) emitting
  the `CompiledQuery` protocol shape: named typed placeholders, safe
  identifier nodes, parameter map, deadline/cancellation context, settings
  allowlist, redacted debug representation. `to_sql()` is the redacted
  debug view, never executable.
- **Acceptance:** `query-implementations-v1` fixtures green — equivalent
  SQL structure, parameter types, and error codes; zero value
  interpolation verified by a lint rule and a grep-based CI check.
- **Review:** Security review required.

### PYB-09 — Dataset client
- **Dependencies:** PYB-08, PYC-01.
- **Scope:** `create_dataset_client(...)` — the canonical entry point,
  mirroring the TypeScript decision that `createDatasetClient` leads and
  backend wiring is advanced-only. Sync and async variants.
- **Acceptance:** Shared example queries return identical rows against the
  integration ClickHouse; in-memory backend equivalent for unit tests.

---

## Train PY-C — Execution and runtime safety

### PYC-01 — ClickHouse executor (`clickhouse-connect`)
- **Dependencies:** PYA-03.
- **Scope:** Sync + async execution of `CompiledQuery` via
  `clickhouse-connect` server-side parameters; strict result codecs;
  driver errors mapped to canonical safe categories; connection config
  redaction; version floor pinned.
- **Acceptance:** Integration matrix against supported ClickHouse versions
  (reuse `pnpm test:integration` Docker setup); no credential or SQL value
  appears in logs/exceptions; parameter fixtures (quotes, null bytes,
  boundary ints, decimals, DST datetimes) executed live.
- **Review:** Security review required.

### PYC-02 — Cancellation, deadlines, and concurrency budgets (RFC 0010)
- **Dependencies:** PYC-01.
- **Scope:** One cancellation contract: ASGI disconnect → asyncio
  cancellation → driver cancellation; bounded executor for sync driver
  work; per-client semaphore and deadlines; deterministic precedence of
  timeout response vs task vs driver cancellation.
- **Acceptance:** Tests distinguish handler cancellation from driver
  cancellation; leaked tasks/threads detected; event loop never blocked by
  unbounded sync work (blocking-detector test).
- **Review:** Security review required.

### PYC-03 — Tenant capability model (RFC 0009)
- **Dependencies:** PYB-08, RFC 0009 accepted.
- **Scope:** Unforgeable server-created tenant capability; fail-closed
  resolution (missing tenant fails before query creation); scoped executor
  with no raw-query escape; cross-tenant admin capability not
  constructible from request data (no `{scope: "all"}` Pydantic shape).
- **Acceptance:** Tenant conformance fixtures green: request cannot
  provide/override trusted scope; joins propagate tenant predicates;
  explicit tenant filter rejected while runtime isolation is active.
- **Review:** Security review required.

### PYC-04 — Cache preimage and opaque keys
- **Dependencies:** TSP-02, PYB-08.
- **Scope:** Canonical cache preimage (in-memory only) → versioned
  HMAC-derived opaque key; memory cache store; pluggable store interface
  with the key contract enforced at the boundary.
- **Acceptance:** `cache-keys-v1` fixtures green; no preimage ever reaches
  a store key, log, or metric label (asserted in tests).
- **Review:** Security review required.

### PYC-05 — Query events and diagnostics (RFC 0011)
- **Dependencies:** PYB-08, RFC 0011 accepted.
- **Scope:** Metadata-only, size-bounded query events; privileged
  diagnostics behind an explicit server-side permission; no Pydantic
  models, rows, or raw errors serialised into events.
- **Acceptance:** `query-events-v1`/`query-diagnostics-v1` fixtures green;
  event snapshot tests prove no raw input/result/error objects.

---

## Train PY-D — Serve (FastAPI)

### PYD-01 — Router core and auth dependency
- **Dependencies:** PYB-08, PYC-03.
- **Scope:** `hypequery.serve` APIRouter factory; authentication as a
  router-level dependency, **default required**; typed canonical auth
  context supplied by the host app; public endpoints require explicit
  code-level opt-in; header bearer/API-key transport only.
- **Acceptance:** Unauthenticated request to any endpoint fails closed by
  default; request state cannot forge auth context or tenant.
- **Review:** Security review required.

### PYD-02 — Dataset and metric endpoints
- **Dependencies:** PYD-01, PYB-09, PYC-05.
- **Scope:** Query/metric endpoints with strict request models (PYB-04),
  pagination, and the RFC 0009 metadata split: public operational metadata
  (request ID, pagination, safe timing, cache state) vs privileged
  diagnostics (SQL, params, tenant) gated on server-side permission —
  never on request input (`includeMeta` alone cannot reveal SQL/tenant).
- **Acceptance:** Response models make privileged fields unrepresentable
  in the public shape; endpoint behavior fixtures match TypeScript serve
  semantics for shared cases.
- **Review:** Security review required.

### PYD-03 — HTTP security profile
- **Dependencies:** PYD-01.
- **Scope:** CORS off unless configured; credentialed origins require an
  exact non-empty allowlist and reject `*`/missing at startup; `no-store`
  default on authenticated/tenant responses; body-size and content-type
  limits; Trusted Host; explicit proxy trust; request-ID grammar
  validation (small ASCII, bounded length) with authoritative server IDs.
- **Acceptance:** Startup fails on credentialed-wildcard config; HTTP
  fixtures for each control; hostile request-ID/log-injection tests.
- **Review:** Security review required.

### PYD-04 — Canonical errors and rate limiting
- **Dependencies:** PYD-01.
- **Scope:** Stable public error envelope matching serve's canonical
  taxonomy (request ID included; no SQL/stack/path/driver detail); rate
  limiting and per-project concurrency admission mirroring serve's
  semantics.
- **Acceptance:** Error snapshot fixtures shared with TypeScript; limit
  exhaustion returns canonical errors and cancels downstream work (with
  PYC-02).

### PYD-05 — Discovery contract endpoint and docs policy
- **Dependencies:** PYB-06, PYD-03.
- **Scope:** Serve the public discovery projection under endpoint policy;
  FastAPI `/docs`, `/redoc`, `/openapi.json` disabled or protected by
  default in production profile; OpenAPI generation from the strict
  models for dev use.
- **Acceptance:** Discovery response contains no SQL/physical/tenant
  fields; production profile has no unauthenticated docs; parity check
  against TypeScript contract endpoint output.

### PYD-06 — ASGI production profile
- **Dependencies:** PYC-02, PYD-03, PYD-04.
- **Scope:** Documented + tested production profile: Uvicorn settings
  (no debug/reload, proxy trust list), loopback-default dev bind,
  concurrency/result-byte/row/timeout ceilings wired to PYC-02 budgets,
  cookie/CSRF rules if cookie auth is enabled.
- **Acceptance:** Profile is a testable config object, not prose; misuse
  (debug on prod profile, 0.0.0.0 without flag) fails at startup.
- **Review:** Security review required.

### PYD-07 — Cross-implementation HTTP conformance
- **Dependencies:** PYD-02 through PYD-06; TSP-03 for full parity.
- **Scope:** Language-neutral HTTP fixture suite (requests + expected
  status/headers/body-shape) run against both Node Serve and FastAPI;
  lives in `specs/` alongside protocol fixtures.
- **Acceptance:** Both implementations pass the shared suite in CI;
  divergences are spec bugs, not per-language behavior.

---

## Train PY-E — DX, docs, supply chain, beta

### PYE-01 — Developer experience
- **Dependencies:** PYD-06.
- **Scope:** Getting-started path: `pip install "hypequery[fastapi,clickhouse]"`,
  a `hypequery.serve.dev` runner (loopback default, clear bind warning),
  project scaffold docs. Decide against a full Python CLI for the beta;
  the Node CLI remains the studio/dev-tool surface.
- **Acceptance:** New-user path from zero to a served dataset in under 15
  minutes, validated by a scripted walkthrough in CI.

### PYE-02 — Examples
- **Dependencies:** PYE-01.
- **Scope:** Three examples in `examples/`: FastAPI embedded analytics,
  multitenant SaaS (tenant capability), and a governed-agent/MCP-adjacent
  pattern. All follow the production profile.
- **Acceptance:** Examples run in CI against the integration ClickHouse;
  no example uses browser credentials, wildcard CORS, or raw SQL on the
  portable path.

### PYE-03 — Documentation
- **Dependencies:** PYE-01.
- **Scope:** `website-next/content/docs/` Python section: authoring,
  querying, serving, security profile, portability rules, TypeScript
  interop (shared bundles/contracts), migration notes for teams running
  both languages.
- **Acceptance:** Docs lead with `create_dataset_client`; every code
  sample is doctest-style checked in CI; parity table
  TypeScript-vs-Python is generated, not hand-maintained.

### PYE-04 — PyPI supply chain
- **Dependencies:** PYA-02, PYE-02.
- **Scope:** Arm the release workflow: PyPI OIDC Trusted Publishing (no
  long-lived tokens), provenance/SBOM, wheel/sdist content verification,
  dependency floors (FastAPI/Starlette/Uvicorn/Pydantic/
  clickhouse-connect), dependency scanning on the resolved matrix.
- **Acceptance:** A `0.x` release publishes end-to-end from CI with
  provenance; artifact audit shows no secrets/local paths; floors block
  known-vulnerable framework versions.
- **Review:** Security review required.

### PYE-05 — Public beta release
- **Dependencies:** PYE-03, PYE-04, all conformance families green.
- **Gates (from the security roadmap, unchanged):**
  - Byte-identical canonical bundle fixtures across languages.
  - No raw Python code in any deployment artifact.
  - All Python security conformance fixtures pass.
  - FastAPI/Starlette/Uvicorn production profile documented and tested.
  - PyPI trusted publishing/provenance operational.
- **Scope:** `hypequery 0.x` public beta announcement; design-partner
  onboarding (target: five external projects executing datasets, two with
  production-like endpoints, per the original PY-11 bar).

### PYE-06 — Cloud qualification (post-beta, optional)
- **Dependencies:** PYE-05 plus Cloud private alpha availability.
- **Scope:** One Python-authored bundle deployed to Cloud for two weeks
  without language-specific security exception before "works with Cloud"
  is advertised. Not a beta blocker.

---

## Suggested sequencing and rough sizing

Assuming one primary engineer plus review capacity, with TSP-01 acceptance
running concurrently in week 1–2:

| Weeks | Focus |
|---|---|
| 1–2 | PYA-00…PYA-02, TSP-01 (0001/0002/0012), start PYA-03 |
| 3–4 | PYA-03…PYA-05 (first cross-language conformance green in CI) |
| 5–8 | PY-B core (PYB-01…PYB-07) + PYC-01 in parallel; remaining RFC acceptances |
| 9–11 | PYB-08/09, PYC-02…PYC-05, TSP-02 |
| 12–15 | PY-D (FastAPI) including PYD-07 shared HTTP suite |
| 16–18 | PY-E: DX, examples, docs, supply chain, beta |

~30 Python PRs + ~8 repo-side PRs. The riskiest items for the schedule are
byte-identical bundle parity (PYB-07 — canonicalisation edge cases) and
cancellation correctness (PYC-02 — asyncio + sync-driver interplay); both are
front-loaded behind fixtures rather than discovered at the end.

## Decisions (recorded 30 July 2026)

1. **Sequencing: dual-run accepted.** Cloud and Python build in parallel.
   Record this override in `PYTHON_SECURITY_HARDENING_ROADMAP.md` and
   `CLOUD_BETA_2026_PR_LEVEL_PLAN.md`. Watch review bandwidth: both tracks
   contain security-review-required PRs and share one reviewer.
2. **Packaging: single `hypequery` distribution with extras** (accepted).
   PyPI names verified available 30 July 2026; reserve per PYA-00.
3. **RFC acceptance (TSP-01):** all 12 RFCs are `Proposed` drafts. Before
   Python implements one, it must be reviewed, open questions resolved, and
   its status flipped to `Accepted` — after which any change requires a new
   protocol version rather than a silent edit. In the current solo context
   this is not a staffing question: it means scheduling a deliberate
   review-and-accept pass per RFC (adversarial model-assisted review is
   fine) and landing the status-change PRs before the corresponding Python
   PR merges. The point is that implementing a draft in two languages
   freezes it accidentally; acceptance freezes it on purpose.
4. **Durable ownership:** the original deferral's condition that Python not
   ship without someone accountable for its ongoing maintenance — PyPI
   releases and security patches, dependency floors, CI matrix upkeep,
   conformance stays green, issue triage. Solo context: this is an
   acknowledgment that Python roughly doubles the supported surface, plus
   mitigation through automation (Dependabot/Renovate on the Python
   matrix, scheduled conformance CI, release automation in PYA-02) so the
   steady-state cost is hours per month, not per week. Accepted implicitly
   by choosing to dual-run.

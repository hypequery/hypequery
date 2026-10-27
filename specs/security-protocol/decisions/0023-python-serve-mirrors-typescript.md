# 0023 — Python Serve mirrors TypeScript: a neutral core, framework adapters, host-context auth

Status: **Accepted** (27 October 2026); open questions resolved below. Supersedes
this record's earlier token-exchange-only draft.

## Context

TypeScript Serve is built in three layers:

1. **A transport-agnostic API.** `createAPI(...)` / `initServe(...)` return an API
   whose `handler` takes a plain `ServeRequest` (method, path, query, headers,
   body, and `raw`, the original framework request) and returns a `ServeResponse`.
   Routing, auth, tenancy, validation, CORS, rate limits, request ids and error
   mapping all live here (`packages/serve/src`).
2. **Thin adapters** (`src/adapters/`): `toFetchHandler` (Hono, Workers, Bun,
   Deno, Remix), `toNodeHandler` (Express, `http`), Vercel, and `startServer`.
   Mounting in Hono is `app.all('/api/*', (c) => toFetchHandler(api)(c.req.raw))`.
3. **Auth strategies** that run inside the host app: `fromContext` reads the
   session the framework already resolved (cookie included) from `request.raw`.
   API-key, bearer and JWT strategies (`createJwtStrategy`, shared secret or JWKS)
   cover separate clients. `createAnalyticsTokenIssuer` mints HS256 tokens
   (`sub`, `org_id`, `roles`) for a host that wants to hand its frontend a token.

Python Serve has none of this layering. `hypequery.serve` is written against
FastAPI and Starlette throughout:

- `ServeRouter` subclasses `APIRouter`, and endpoints take a FastAPI `Request`;
- host, CORS and production limits are Starlette middleware;
- errors go through FastAPI exception handlers;
- disconnects are detected through Starlette;
- the authenticator receives only a header credential, by design.

Building Django and Flask demo apps on top of it (PR #771 and its follow-ups)
showed the consequences:

- **Django and Flask need FastAPI** to serve React hooks or MCP. They mount a whole
  second app beside themselves: through Django's ASGI app, or through a2wsgi in
  Flask.
- **They can't use their own login for those endpoints.** The second app can't see
  `request.user` or the session, so every same-origin React app needs a token
  hop that TypeScript apps don't.
- **There's no story for other Python frameworks.** Litestar, Quart, Sanic,
  Starlette-only apps and plain WSGI have no path that doesn't involve FastAPI.

This is a design gap, not a missing feature: the TS/Python lag-not-divergence
principle expects the same shape in both languages.

## Decision

Restructure `hypequery.serve` to match TypeScript. This happens before the first
PyPI release, so superseded APIs are removed, not deprecated.

### 1. A framework-neutral core

`hypequery.serve` gains a core that imports no web framework:

- `ServeRequest`:
  - `method`, `path`, `query` (multi-valued) and `headers` (multi-valued,
    lowercase);
  - `body: bytes`, read lazily and bounded by the body policy;
  - `client` (peer address) and `raw` (the framework request);
  - `is_disconnected`, an optional async callable for cancellation.
- `ServeResponse`: `status`, `headers`, and a JSON body or bytes.
- `create_api(...)`: endpoints, auth strategy, tenant resolver, `HttpSecurity`,
  `ProductionProfile`, rate limits and query events. It returns an `Api` with
  `async handle(request) -> ServeResponse`.

Everything Serve does today moves behind `handle`, implemented over
`ServeRequest`:

- authenticate-before-body;
- strict client endpoints and schema pins;
- trusted hosts and proxies, CORS and preflight;
- body limits, production budgets and rate limits;
- request ids;
- the error envelope and `no-store`.

Pydantic validation stays; it is already a core dependency.

The shared HTTP conformance fixtures (`specs/serve-http`) run against `handle`
directly, so the protocol is tested once, without a server.

### 2. Adapters

| Adapter | For | Notes |
| --- | --- | --- |
| `hypequery.serve.asgi.to_asgi_app(api)` | uvicorn, Starlette, FastAPI (`app.mount`), Litestar, Quart, Django ASGI | Pure ASGI. Needs no Starlette, and cancels on client disconnect |
| `hypequery.serve.wsgi.to_wsgi_app(api)` | gunicorn, any WSGI framework | Runs the core on a process-wide event-loop thread |
| `hypequery.contrib.django.urls(api)` | Django | Native views (async under ASGI, sync under WSGI); `raw` is the `HttpRequest` |
| `hypequery.contrib.flask.blueprint(api)` | Flask | A native blueprint; `raw` is Flask's `request` |
| `hypequery.serve.start_server(api, ...)` | Standalone | uvicorn on `to_asgi_app`; `ProductionProfile` as today |

FastAPI becomes one consumer among others. The `fastapi` extra shrinks to
`uvicorn` for `start_server`/`hypequery dev`, plus FastAPI itself only for
development OpenAPI docs (see open questions). `mount_serve` and the a2wsgi
bridge from PR #771 are removed: Django and Flask serve the endpoints natively.

### 3. Auth strategies, matching TypeScript

| Python | TypeScript | Credential |
| --- | --- | --- |
| `bearer_token(validate)` / `api_key(validate)` | `createBearerTokenStrategy` / `createApiKeyStrategy` | One header, as today |
| `from_context(extract)` | `fromContext` | The host app's request; `extract(request)` reads `request.raw` |
| `jwt_strategy(secret=…\|jwks_url=…, audience, issuer)` | `createJwtStrategy` | Bearer JWT, TS-compatible claims (`sub`, `org_id`, `roles`, `scope`) |
| `analytics_token_issuer(secret, expires_in)` | `createAnalyticsTokenIssuer` | Mints tokens either language's `jwt_strategy` accepts |

The contrib packages add `from_context` helpers:

- Django: `django_user(to_principal)`, which reads `request.user`, loaded through
  the async ORM in async views;
- Flask: `flask_session(to_principal)`, which reads `session` or Flask-Login's
  `current_user`.

Same-origin React apps then use the existing login with no token. JWT and the
token issuer cover separate frontends and the MCP bridge.

### 4. RFC 0009 amendment

RFC 0009's construction rule ("request input … beyond the opaque credentials
passed to the authenticator MUST NOT contribute roles, scopes, tenant
identity…") is rewritten to what both languages enforce:

- hypequery itself never derives identity from request input;
- only the host's auth strategy (trusted host code) may, and it may read the
  host's own session state through `raw`;
- query bodies, endpoint inputs and client-contract fields still can't select a
  tenant, scope or role;
- the tenant resolver still derives the tenant only from the principal.

### 5. CSRF for context-based auth

TypeScript leaves CSRF to the host framework. Python makes it explicit:

- `from_context` takes `same_origin: bool = True`. When true, the core rejects
  unsafe methods unless `Sec-Fetch-Site` is `same-origin` or `none`, or `Origin`
  is in `HttpSecurity.cors.origins`.
- Django's adapter also leaves Django's own CSRF middleware active, so the React
  client sends `X-CSRFToken`.
- Header-credential strategies are not cookie-borne, so they need neither.

The production profile accepts `from_context` with `same_origin=True` and refuses
it with `same_origin=False`. That replaces today's flat cookie ban.

## Delivery plan (each a PR with tests and shared-fixture runs)

1. **Core types and pipeline** (auth, errors, request ids, body policy,
   endpoints) behind the existing FastAPI surface. The FastAPI layer delegates to
   `api.handle`. The fixtures run against `handle` and still pass through FastAPI.
2. **Security in the core:** hosts, proxies, CORS, production budgets and rate
   limits, removing the Starlette middleware.
3. **Public `create_api` and `to_asgi_app`.** Remove `ServeRouter`/`create_app`;
   port `start_server` and `hypequery dev`; FastAPI becomes optional.
4. **`to_wsgi_app`, Django `urls(api)` and Flask `blueprint(api)`.** Remove
   `mount_serve` and a2wsgi.
5. **Auth:** `from_context` with the same-origin check, contrib `django_user` /
   `flask_session`, `jwt_strategy`, `analytics_token_issuer`, cross-language JWT
   fixtures, and the RFC 0009 amendment.
6. **CLI scaffolds, docs, examples and the demo apps** (`init --framework`
   generates native endpoints).

Each step keeps the full suite and `pnpm conformance:serve` green. Steps 1–2
change no public API.

## Consequences

- Django and Flask users get React and MCP support with no FastAPI and no token,
  using their own login. Any ASGI or WSGI framework is supported through two
  adapters.
- Python and TypeScript share one mental model and one auth vocabulary, and JWTs
  verify across languages.
- A large refactor of `hypequery.serve` before the first PyPI release. The
  conformance fixtures are the safety net.
- PR #775 (lazy clients) still applies. PR #771's `mount_serve` helpers and
  #773's scaffold text change in step 4/6.

## Resolved questions

1. **Development OpenAPI docs come from the core.** OpenAPI is generated from the
   endpoint definitions, as TypeScript's `openapi.ts` does, so FastAPI isn't
   needed even for `development_docs=True`.
2. **JWT via PyJWT, as a `jwt` extra.** No hand-written token cryptography. The
   core imports it only when a JWT strategy or token issuer is created.
3. **Context auth uses the same-origin check and Django's CSRF.** Django's
   adapter leaves Django's CSRF middleware active (the React client sends
   `X-CSRFToken`), and the core also applies the same-origin check.
4. **`create_api(auth=...)`**, renamed from `authenticate=` for parity with
   TypeScript's `createAPI({ auth })`. Pre-release, so there's no alias.

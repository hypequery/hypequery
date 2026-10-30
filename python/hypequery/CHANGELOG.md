# Changelog

## Unreleased

<!-- towncrier release notes start -->

## 0.1.0b1 (2026-10-30)

- `hypequery init --framework standalone|django|flask` chooses the application
  written beside `datasets.py` (decision 0023 step 6). `standalone`, the
  default, is `app.py`: an API from `create_api`, served as plain ASGI by
  `hypequery dev` with no web framework. It replaces the `fastapi` choice,
  which wrote the same app; to use FastAPI, mount `app` in it.
- `--framework django` writes a small runnable Django project (`settings.py`,
  `urls.py`, `manage.py`) and `analytics.py`; `--framework flask` writes a
  Flask `app.py`. Both serve hypequery's endpoints natively (`urls(api)`,
  `blueprint(api)`) twice: at `/api/analytics` behind the framework's own
  login (`django_user`, `flask_session`) with the same-origin check, and
  Django's CSRF middleware, for `@hypequery/react`; and at `/api/agents` behind
  a bearer token (`HYPEQUERY_DEV_TOKEN` in development), for `@hypequery/mcp`.
  Each also has a view or route of its own on the per-request client. Until
  wired to a login, Flask's session API and route answer 401, and
  tenant-scoped datasets refuse signed-in Django users. Pyproject extras are
  `django` or `flask`; the README covers secrets, hosts, `jwt_strategy` and
  moving the pieces into an existing Django project.
- `--framework` works with `--skip-connection`: each framework gets the
  offline orders example, with `datasets.py` and `seed.sql`. The standalone
  example's dataset now lives in `datasets.py` too.

- `hypequery init` accepts `--tenant-column`, like `generate datasets`, so a tenant-scoped project needs one command.
- `hypequery init` records `--tables` / `--exclude-tables` in `schema.json`, and `generate datasets` reuses that selection unless given `--tables`, `--exclude-tables` or the new `--all-tables`. Regenerating no longer widens a project to every table in the database.
- The scaffold's `.env.example`, README and `app.py` match how discovery connected: `CLICKHOUSE_URL` when it was set, otherwise the host, port and TLS setting discovery used. Credentials stay placeholders.
- "Possible tenant column" review notes name the `--tenant-column` flag that sets the key.
- `generate datasets` and `export client-contract` print normalised paths.

- Add `label` and `description` to `Dataset` and `dataset(...)`. Client-contract
  exports and live discovery now advertise dataset, dimension and measure
  label/description as optional endpoint `annotations` (RFC 0018 amendment), so
  MCP agents listing datasets see each dataset's own description. Whitespace runs
  are folded and blank text is omitted; text over 4096 UTF-8 bytes or containing
  control characters fails export. Annotations are excluded from `schemaHash`,
  so editing a description does not trigger `CLIENT_SCHEMA_CHANGED`. Pair with
  `@hypequery/mcp`/`@hypequery/cli` releases that understand annotations.

- The Django and Flask integrations' process-wide client connects on its first query, not when it is created. Modules can hold `get_client()` (Django) or the new `hq.client_for(app)` (Flask, no app context needed) at import time, and the app starts even with ClickHouse down. A closed client refuses to reconnect.

- Publish a dataset's `description` in deployment contracts and bundles, matching
  TypeScript. The contract has no dataset-level label, so `Dataset.label` is not
  published there. Descriptions follow the existing deployment text rules: blank,
  multi-line, control-character or over-4096-byte text fails the export.

- Docs: `django_user`'s page must set Django's `csrftoken` cookie
  (`ensure_csrf_cookie`, or a template using `{% csrf_token %}`), or Django
  answers its own HTML `403` before hypequery runs. The `django_user` and
  `urls` docstrings and the `--framework django` scaffold's README now say so.

- `hypequery.contrib.django.urls` answers a `Host` outside `ALLOWED_HOSTS` as the core answers one, `400 Invalid host header` as plain text, instead of Django's HTML `DisallowedHost` page (the technical page under `DEBUG`). It carries the core's `x-request-id` (and a valid caller id as `x-correlation-id`) and is still logged to `django.security.DisallowedHost`. A host refused by middleware before the view runs, such as `CommonMiddleware`, still gets Django's own response.

- Docs: explain that per-endpoint `schemaHash` values (not the document `contentHash`) match between the build export and the live discovery view, and how measure values differ between in-process results and hypequery's HTTP wire.

- When ClickHouse rejects the server's own connection, the error is now a server fault instead of the caller's. A wrong password or unknown user (`AUTHENTICATION_FAILED`, `UNKNOWN_USER`, `WRONG_PASSWORD`, `REQUIRED_PASSWORD`, `IP_ADDRESS_NOT_ALLOWED`, `USER_EXPIRED`), a missing grant (`ACCESS_DENIED`, `DATABASE_ACCESS_DENIED`, `NOT_ENOUGH_PRIVILEGES`), a missing database (`UNKNOWN_DATABASE`) and a readonly-profile mismatch all raise `CompiledQueryError("unavailable")`, which `hypequery.serve` answers with `503 CLICKHOUSE_UNREACHABLE` and the fixed message "The query executor is unavailable.". Before, they answered `401 UNAUTHORIZED`, `403 FORBIDDEN` or `404 NOT_FOUND` with text that named ClickHouse. That sent browser and agent clients into re-login loops for a fault only an operator can fix. RFC 0010 keeps `unauthenticated` and `forbidden` for the authentication layer.
- `CompiledQueryError` has two new fields that never appear in the envelope: `code` (for example `HQ_EXECUTOR_CREDENTIALS_REJECTED`, `HQ_EXECUTOR_ACCESS_DENIED`, `HQ_EXECUTOR_DATABASE_MISSING` or `HQ_EXECUTOR_READONLY_MISCONFIGURED`) and `diagnostic`, a sentence for operators. `hypequery.serve` logs both to the `hypequery.serve` logger with the request id and query id. The readonly guidance that used to be the error message is now the `diagnostic`. CLI hints are keyed by `code`.

- `hypequery.contrib.flask.blueprint` exempts an API that reads a header credential (bearer, API key, JWT) from Flask-WTF's `CSRFProtect`, whether `CSRFProtect` is set up before or after the blueprint is registered. Previously an app using `CSRFProtect` answered every agent `POST` with Flask-WTF's HTML `400 The CSRF token is missing`. A blueprint for an API on the app's own login (`flask_session`) is still checked, so the page sends the token as `X-CSRFToken`.

- `ClickHouseConnection.from_url()` reads `clickhouse://`, `clickhouses://`, `http(s)://` and SQLAlchemy HTTP-interface URLs (`clickhousedb://`, `clickhouse+http://`); `from_env()` (and the CLI) also read `CLICKHOUSE_URL`, which cannot be combined with the field variables. Native-protocol URLs are refused with an explanation, and no error repeats the URL.
- Dataset results carry `column_types` from the dataset definition and convert to typed DataFrames with `to_pandas()`, `to_polars()` and `to_arrow()` (new `pandas`, `polars` and `arrow` extras). Timestamps become timezone-aware datetimes in the query timezone, counts nullable integers, numbers floats or, with `decimals="decimal"`, exact decimals.
- New `hypequery.contrib.django` (`django` extra): `HYPEQUERY` settings validated by `manage.py check`, a per-process client closed at exit, and middleware giving each request a lazily built, tenant-bound `request.analytics` (in async views, an awaitable client whose tenant function runs off the event loop, so it may use the ORM).
- New `hypequery.contrib.flask` (`flask` extra): a `Hypequery` extension with `app.config` keys, a `tenant_loader`, and per-request tenant-bound `client` / `async_client`.
- New `hypequery.contrib.sqlalchemy`: `executor_from_engine()` and `connection_from_engine()` point hypequery at a SQLAlchemy engine's ClickHouse server with hypequery's own clients.
- New `create_async_from_sync_clickhouse_executor()`: a thread-backed async executor that needs only the `clickhouse` extra. `AsyncFromSyncClickHouseExecutor.close()` now also closes its driver clients.
- Served query metadata omits `cache` when the dataset client has no result cache, matching TypeScript. It previously reported `{"hit": false}` on every query, which read as a cache miss.

- `hypequery init` and `hypequery generate datasets` write a table's ClickHouse `COMMENT` as the dataset's `description=` and a column's as the dimension's, so client contracts and MCP agents describe datasets from the catalog instead of a generic fallback. Whitespace runs become one space and control characters are dropped to fit the deployment contract; a comment over 4096 bytes is shortened with a review warning. `schema.json` records the comments, only where set.

- Protocol deployment validation now accepts `merge` measures with a `stateFunction` from the allowlist (RFC 0022), with the same rules as TypeScript: no filters or `sql`, and in contract 3 an `approximate` marker exactly for estimating states. This adds protocol representation only; Python code-first datasets do not yet author merge measures.

- Protocol validation accepts the `isNull` and `isNotNull` comparisons (RFC 0023), with the same rules as TypeScript: an expression comparison has `left` and no `right`, deployment filter operator lists and client contract filters may name them on any type, and a client query filter using one has no `value`. A value on them is rejected. This adds protocol representation only; Python code-first datasets do not yet author null-check filters.

- Protocol deployment validation now preserves explicit `rowResolution` FINAL policies, including the engine-less `{"kind": "final"}` form, replacing soft-delete columns and collapsing sign columns, with the same strict grammar as TypeScript. This adds protocol representation only; Python code-first datasets do not yet author resolved sources.

- The same-origin check for `from_context`, `django_user` and `flask_session`
  now also accepts an unsafe request whose `Origin` is the request's own
  origin, its scheme and `Host`, as Django's CSRF check compares them. A
  browser without Fetch Metadata (Safari before 16.4) calling its own site no
  longer needs that site listed in `CorsPolicy`. `ServeRequest` gains `scheme`,
  which every adapter fills in (Django's and Flask's own, so
  `SECURE_PROXY_SSL_HEADER` and `ProxyFix` apply); a trusted proxy's
  `X-Forwarded-Proto` overrides it.

- Every response from `hypequery.serve` now carries
  `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`; a
  route that sets its own policy keeps it. The `Invalid host header` refusal is
  sent with `Cache-Control: no-store`.
- The development docs page (`development_docs=True`) loads an exact Redoc
  release checked by Subresource Integrity, instead of whatever `redoc@2`
  currently is, under a Content-Security-Policy that allows only that script,
  and sends `Referrer-Policy: no-referrer`.
- A request body must be UTF-8 JSON as `JSON.parse` reads it: `NaN` and
  `Infinity`, strings holding a lone surrogate (`"\ud800"`) and nesting deeper
  than 64 levels are refused with `400 VALIDATION_ERROR`. A lone surrogate in a
  filter value, and a deeply nested one, used to fail as a `500`; UTF-16 and
  UTF-32 bodies are no longer guessed at.
- The `django` extra requires `sqlparse>=0.6.0` and the `flask` extra
  `jinja2>=3.1.6`, the first releases free of published advisories; Django and
  Flask themselves admit older ones.
- The sdist no longer picks up local coverage data, reports, `.env` files or
  SQLite databases from the checkout it is built in, and the release artifact
  audit refuses an archive that contains them.

- Internal refactor, no API or wire change: the HTTP security profile now lives
  in the framework-neutral serve core (decision 0023 step 2). Trusted hosts,
  proxy trust, CORS, request ids, route rate limits and production budgets are
  implemented once in `hypequery.serve.core`; `Api.handle` applies them, and the
  FastAPI middleware and `RateLimit` dependency call the same code. Responses
  are byte-for-byte unchanged.

- `hypequery.serve` no longer needs FastAPI (decision 0023 step 3). `create_api(auth=...)` returns a framework-neutral `Api`, modelled on TypeScript's `createAPI`: `auth=` (renamed from `authenticate=`), `credentials=`, `tenant=` (renamed from `resolve_tenant=`), `security=`, `production=`, `limits=`, `events=`, `base_path=` (replacing `prefix=`), `max_body_bytes=`, `development_docs=`, `openapi=` and `client_mount_path=`. `datasets={"name": dataset}` serves `POST /datasets/<name>/query`, `metrics={"name": create_metric_endpoint(...)}` serves `POST /metrics/<name>`, and with either `GET /discovery` is served, authenticated by default. `api.add_route(method, path, handler)` serves your own routes; `await api.handle(ServeRequest(...))` serves a request with no server.
- New `to_asgi_app(api, lifespan=...)`: a pure ASGI application with no Starlette, for uvicorn and any ASGI server, or to mount in FastAPI, Starlette or Litestar. It streams the request body lazily under the body policy, cancels a query whose caller disconnects, runs the optional lifespan context and closes websockets. With a production profile, writing the response is inside the request's admission slot and deadline.
- Development OpenAPI (3.1) and docs come from the routes' own Pydantic schemas (`openapi_document(api)`, `OpenApiInfo`): `GET /openapi.json` and a Redoc page at `GET /docs`, as in TypeScript. `/redoc` is gone.
- `start_server(api)`, `run_dev(api)` and `hypequery dev` run an API or its `to_asgi_app` application on uvicorn. The `fastapi` extra is replaced by `server`, which installs only uvicorn; `hypequery.serve` itself needs no extra (anyio is now a base dependency).
- Removed, before the first PyPI release: `ServeRouter`, `create_router`, `create_app`, `install_http_security`, `request_id(request)` (read `call.state.request_id`), the `RateLimit` FastAPI dependency (pass `limits=` instead) and the `routers=` arguments of `export_client_contract` and `add_client_contract_endpoint`. `export_client_contract` takes the API or its ASGI application. `ServeError` is no longer a FastAPI `HTTPException`.
- Routing matches the path as sent, as TypeScript does: a trailing slash is `404 NOT_FOUND` instead of FastAPI's `307` redirect, and a percent-encoded path no longer matches its decoded route. Every other answer is byte-identical to the FastAPI layer's, header order aside.

- `hypequery.serve.from_context(extract)` authenticates with the host app's own login, as TypeScript's `fromContext` does: `create_api(auth=from_context(extract))` hands `extract` the `ServeRequest`, which reads the session from `request.raw` and returns a `Principal` or None (401). A same-origin React page then calls the endpoints with its session cookie and no token. With `same_origin=True`, the default, the core refuses `POST`, `PUT`, `PATCH` and `DELETE` with `403 FORBIDDEN` unless `Sec-Fetch-Site` is `same-origin` or `none`, or `Origin` is in the API's `HttpSecurity.cors.origins`, under every adapter. A sync extractor runs on the request's own thread under WSGI, Django and Flask (`ServeRequest.run_on_request_thread`).
- `hypequery.contrib.django.django_user(to_principal)` and `hypequery.contrib.flask.flask_session(to_principal)` build these strategies. `django_user` reads `request.user`, through the async ORM in async views; `flask_session` reads Flask-Login's `current_user` when the app uses Flask-Login, else `session`. Django's `urls(api)` leaves Django's CSRF middleware active for them, so the page sends `X-CSRFToken`; header credentials (bearer, API key, JWT) stay CSRF-exempt.
- Production now accepts `from_context` and refuses `from_context(..., same_origin=False)`, replacing the flat cookie ban: `ProductionProfile(cookie_auth=...)` is removed, and `bearer_token`/`api_key` refuse the `cookie` header in any profile.
- The Django and Flask examples serve their API behind their own login for a same-origin React page, and behind a bearer token at `/api/agents` for the MCP bridge.

- `jwt_strategy` and `analytics_token_issuer` in `hypequery.serve`, with a new `jwt` extra (PyJWT and cryptography). `jwt_strategy(secret=... | jwks_url=..., issuer=, audience=)` is an authenticator for `create_api` that verifies JWT bearer tokens and maps `sub`, `org_id`, `roles` and `scope`/`scopes` to the `Principal`, as TypeScript's `createJwtStrategy` does. `analytics_token_issuer(secret)` mints the short-lived tokens `createAnalyticsTokenIssuer` mints. Tokens from either language verify in the other; shared fixtures (`specs/serve-http/fixtures/jwt-v1`) pin which tokens both accept and refuse. Key sets are fetched off the event loop with a timeout and cached; an unreachable key set answers 503. Python is stricter than TypeScript in a few places: it refuses tokens without `sub`, HMAC secrets shorter than the hash, and `http` key-set URLs outside localhost.

- Internal refactor, no API or wire change: `hypequery.serve` now runs its
  dataset, metric, discovery and client-contract routes through a
  framework-neutral core (`hypequery.serve.core`, decision 0023 step 1). The
  core owns authentication before the body is read, the body policy, request
  ids, strict client-contract validation and the error envelope. FastAPI routes
  delegate to it, and OpenAPI docs and responses are unchanged. The core is
  internal until a later release makes it public.

- Django's `urls(api)` now checks the request's `Host` against `ALLOWED_HOSTS`
  itself, so an API without an `HttpSecurity` is protected even in a project
  without `CommonMiddleware`.
- `ServeRequest.is_disconnected` is replaced by `wait_disconnected`, an
  awaitable that returns once the caller has gone. The core no longer polls for
  disconnection every 50 ms per running query.
- The default tenant resolver runs inline instead of on a worker thread for
  every authenticated request.
- A WSGI, Django or Flask request arriving after interpreter exit has stopped
  the serving loop is refused instead of starting a loop that is never closed.
- Removed the re-export modules `hypequery.serve.security`,
  `hypequery.serve.rate_limit`, `hypequery.serve.request_ids` and
  `hypequery.serve.errors`; import those names from `hypequery.serve`.

- Django and Flask serve hypequery's HTTP endpoints natively, for
  `@hypequery/react` and `@hypequery/mcp`, with no FastAPI and no second app
  (decision 0023 step 4). `hypequery.contrib.django.urls(api)` returns URL
  patterns to `include()` below any prefix: the view is async under ASGI and
  sync under WSGI, `ServeRequest.raw` is the `HttpRequest`, and the body is
  read from the request's stream, bounded by the API's body policy rather than
  `DATA_UPLOAD_MAX_MEMORY_SIZE`. The views are CSRF-exempt because their
  credential is a header; Django's CSRF middleware stays installed.
  `hypequery.contrib.flask.blueprint(api)` returns a blueprint to register
  below any `url_prefix`; `raw` is Flask's request, and host code runs in the
  request's Flask context. Client contracts and discovery name the paths a
  request was routed under, unless `client_mount_path` is set.
- `hypequery.serve.to_wsgi_app(api)` serves an API to gunicorn, waitress or any
  WSGI framework. Sync hosts run the API on one event loop per process, on its
  own thread, while the request's thread waits and reads the body for it, so
  no loop is created per request and threaded servers serve requests
  concurrently. The loop restarts in each forked worker and stops at exit.
- `Api.handle` and `Api.serve` take `mounted_at=`, the prefix a host
  framework's router served the request under, for adapters mounted inside one.

- `HttpSecurity(allowed_hosts=...)` now matches bracketed IPv6 literals (`[::1]`
  allows `[::1]:8000` and `[0:0::1]`), compares names case-insensitively and
  ignores a trailing dot. An allowed host that is not a valid host, such as
  `[nope]`, is refused when the profile is built.
- With CORS configured, every response carries `Vary: Origin`, including
  responses to requests without an `Origin`, and preflight answers also vary on
  `Access-Control-Request-Method`, `-Headers` and `-Private-Network`. This
  keeps shared caches from serving one origin's answer to another.

- Avoid terminating the process holding a dataset regeneration lock on Windows.
- Give the ClickHouse installation hint only when that driver is the missing app dependency, including when the executor factory reports it.
- Redact application import errors in development reload workers as well as initial startup.

- Add authenticated `add_client_contract_endpoint` discovery for installed strict
  client endpoints. Apply each target's role/scope/tenant policy before projection,
  sign the caller's authorized view, and return no-store responses that vary by
  credential transport. Keep metric-only/empty views valid, enforce a bounded
  response budget without truncation, and expose no tenant values or physical SQL.

- Add `hypequery export client-contract --factory module:factory` for offline
  canonical artifacts, including JSON-only stdout, bounded input/output handling,
  read-only drift checks and explicit atomic replacement. Validate both signed
  contracts and prepared identities, redact factory chatter/import failures, and
  preserve concurrent edits and file permissions without importing serving/driver
  extras. The explicitly named project factory should use definition-only SDK APIs.

- Add definition-only `ClientEndpointDefinition`, `ClientQueryProfile`, and
  `export_client_contract` APIs for deterministic frontend/MCP build artifacts.
  Export logical dimensions, safe related measures, target-authorized filters,
  metric output aliases, effective definition limits and ordered base defaults
  without importing FastAPI, connecting to ClickHouse, or exposing physical SQL.

- Add portable client-contract v1 models, bounded JSON decoding, canonical identities,
  and strict HTTP/MCP query validation for generated React and MCP integrations.
  Validate the same shapes, safe failures and query profile as TypeScript through
  a required shared conformance family.

- Add a runnable Python → generated React → HTTP MCP tutorial with tenant-scoped ClickHouse serving, decimal/null seed data, per-login browser cache isolation and installed-artifact preparation.

- Add opt-in `client_profile` bindings for Python dataset/metric endpoints and
  router/application client-contract export using resolved FastAPI paths.
  Enforce the advertised strict query profile, clamp against actual policy,
  client and production ceilings, and check `X-Hypequery-Client-Schema` only
  after authorization. Reject stale pins with a safe HTTP 409. Legacy endpoints
  retain their input behavior and are omitted from client exports. Add trusted
  `client_mount_path` configuration and the matching default CORS allow-header.

- Disable automatic ClickHouse driver sessions for owned query/control clients so overlapping HTTP and worker queries can share an executor without session-lock failures.

- Add `ClickHouseConnection.from_env()`, reading `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`,
  `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USERNAME`, `CLICKHOUSE_PASSWORD` and
  `CLICKHOUSE_SECURE`. Malformed ports and booleans are refused by variable name. An
  unset port lets the driver choose 8123, or 8443 when secure. The CLI, project
  scaffolds and examples now use it, so scaffolded apps honour `CLICKHOUSE_SECURE`.
- ClickHouse executors are context managers (`with` / `async with`) that close their
  connections on exit.
- The async executor's cancellation-control connection now uses the same 2-second
  receive timeout as the sync executor's.

- Fix deployment contracts that widened a filter declared with an empty `operators`
  allow-list to every operator. The empty list now reaches protocol validation and is
  rejected, matching TypeScript, so a deployment can no longer accept filters the local
  planner refuses.

- Fix `hypequery init` and `hypequery generate datasets` emitting a SQL-backed
  `totalCount` measure without dependencies, which made every generated project fail
  to build a deployment contract and refused relationship joins. `totalCount` now
  counts the first supported non-nullable column. All-nullable tables instead
  receive the explicitly named `nonNullCount`, with a warning that it excludes nulls.

- Fix deployment of measure filters with integer values, such as
  `filter.gte("amount", 10)`, which failed with `HQ_VALUE_INTEGER_TAG_REQUIRED`. An
  exactly representable integer now publishes as the same binary64 number TypeScript
  writes, with an identical deployment identity. Integers beyond 2**53 are refused with
  a clear error rather than rounded.

- `TenantDatasetClient.execute` and `AsyncTenantDatasetClient.execute` accept
  `paginate=True`, as the unbound clients do, so request handlers holding a
  tenant-bound client can fetch pages with `has_more` metadata.

- Bind timestamp parameters as Unix seconds. RFC 3339 filter values such as
  `2026-10-25T01:30:00Z` were rejected by ClickHouse, and aware datetimes could
  resolve to the wrong instant on a non-UTC server in a repeated daylight-saving
  hour. Values without an offset are passed through unchanged.
- Add `run_dev` and `python -m hypequery.serve.dev app:app` for local
  development. The runner binds to loopback by default, warns with
  `ExternalBindWarning` when bound beyond it, supports `--reload`, and refuses
  apps created with a `ProductionProfile`.
- Add a README Getting started path from install to a served dataset, run as
  written from a built wheel against ClickHouse in CI.
- Add a validated ASGI production profile and Uvicorn runner with explicit bind
  and proxy trust, startup refusals for debug/docs/reload/cookie auth, bounded
  admission, cancellation-aware deadlines and database/HTTP result ceilings.
- Qualify shared HTTP fixtures under the production profile, test the real runner
  and add the production HTTP path to the live ClickHouse matrix.
- Add authenticated dataset and measure-backed metric HTTP endpoints with role,
  scope, tenant, and page-size policy; support synchronous and asynchronous clients.
- Add accurate over-fetch pagination without changing ordinary client executions.
- Return public operational metadata separately from authorized, audited, redacted
  SQL diagnostics. Semantic measures use strings on the HTTP wire, matching
  TypeScript; local client result values retain their native types.
- Propagate disconnect and handler cancellation to execution; optionally emit
  validated, metadata-only RFC 0011 success and failure events.
- Add bounded logical discovery and an application factory with docs and OpenAPI
  disabled by default. Development documentation requires explicit opt-in.
- Run shared semantic HTTP fixtures in Python and TypeScript CI, including the
  FastAPI and Uvicorn floors.

- **Breaking (pre-release):** every authoring helper now lives in exactly one
  namespace: `dimension.*`, `measure.*`, `filter.*`, `order.*` and the new
  `formula.*` (`formula.divide`, `formula.null_if_zero`, `formula.round`, …).
  `hypequery.datasets` no longer re-exports the loose helpers. That covers the
  aggregations (`sum`, `count`, `min`, `max`, …), the filters (`eq`, `in_list`, …),
  the orderings (`asc`, `desc`) and the formula functions (`divide`, `round`, …).
  The package no longer shadows Python builtins such as `sum`, `min`, `max` and
  `round`. Write `measure.sum("amount")`, `filter.eq("status", "paid")`,
  `order.desc("revenue")` and `measure.derived(formula.divide("a", "b"))`.
- **Breaking (pre-release):** `hypequery.serve.validate_correlation_id` is now
  `sanitize_correlation_id`. The new name says it returns the caller's id or `None`
  instead of raising. It no longer shares a name with the planner's
  `validate_correlation_id`, which raises.
- `create_api` and `start_server` are now the definitions, matching TypeScript, and
  their error messages use those names. `create_router` and `run_production` remain
  as aliases.

- Add `measure.derived(formula)` over local numeric measures, including validated references/dependency cycles, aggregate planning, HAVING, HTTP serving, and safe discovery.
- Emit derived formulas and inputs in catalogs, semantic snapshots and deployment contract 2, with shared TypeScript fixtures. Chained derived measures execute locally but cannot be exported under contract 2; relationship traversal remains limited to base measures.
- Formula limits and literal types match TypeScript: at most 256 nodes and 16 levels per formula, and integer literals keep integer arithmetic (`add("orders", 1)` returns an integer).

- Serialize relationship-qualified measures as strings (preserving NULL), like
  local measures, without changing dimension values or native client results.
- Allow `X-Include-Meta` in the default CORS request-header policy so React
  infinite dataset and metric queries can request pagination across origins.
- Stop suggesting `totalCount` for tables with no supported non-nullable column.
  Generate `nonNullCount` with an explicit warning instead, and use it in the
  scaffold example. It counts non-null values, not every row. Review existing
  `totalCount` references when regenerating definitions for these tables.

- Add explicit `time_grains` policies to Python datasets, enforced by the planner and dataset/metric HTTP endpoints and reflected in catalogs, semantic contracts and OpenAPI. Unsupported grains are rejected with TypeScript's message, `Unsupported time grain "hour". Supported: day, month`.
- Deployment export refuses a policy that excludes any day-through-year grain, because contract 2 cannot preserve it. A policy that includes every one of those grains publishes unchanged, matching TypeScript.

- Add validated query and client timezones (UTC by default), apply the zone to time buckets and local time-key filter bounds, and accept timezone overrides on dataset and metric HTTP endpoints.
- **Behavior change:** time buckets and offset-free time-key bounds previously used the column's or server's timezone; they now use the query zone, UTC unless set. Pass `timezone=` to `create_dataset_client` to keep a non-UTC zone. Persistent result caches populated before upgrading can return old buckets until their entries expire.
- Partition non-UTC cached results using the same deployed-identity convention as TypeScript.

- **Behavior change:** `minute`, `hour` and `day` buckets now return `period` as wall-clock text in the query timezone, `YYYY-MM-DD HH:MM:SS` (RFC 0015), matching TypeScript. They were previously UTC ISO instants such as `2026-01-02T05:00:00+00:00`. Week-and-longer buckets are unchanged (`YYYY-MM-DD`). A shared fixture, `specs/datasets/period-format-v1.json`, now pins the form in both languages.

- Add Python release automation with opt-in canaries after successful main CI,
  tagged beta/RC/stable releases, build-only rehearsals, artifact and CLI checks,
  and token-free PyPI Trusted Publishing.
- Prepare Python beta/stable release PRs with Towncrier, explicit version
  selection, synchronized package metadata and lockfile, preserved changelog
  history, and Python CI against the generated release commit.

- Audit locked and minimum runtime dependency resolutions across supported Python versions, and retain release SBOMs, audit reports and distribution checksums.
- Require urllib3 2.8.0 or newer for ClickHouse execution, fixing three published advisories. Raise core and serving dependency floors to the versions qualified by the beta suite.

- Preserve nulls for unmatched related dimensions and filters independently of ClickHouse `join_use_nulls`, including queries without related measures. Missing or other-tenant targets no longer appear as empty strings or zero values.

- `ResultCache(on_error=...)` observes cache failures that would otherwise be silent.
  Failures still never fail a query. The hook receives the stage (`"key"`, `"get"` or
  `"put"`) and the exception; without it, failures are logged at debug level by
  exception type only. `ExecuteOptions` types the options tenant-bound clients
  forward, and `DEFAULT_PAGE_SIZE` names the default page size.

- Select one-hop relationship base measures as `<relationship>.<measure>`,
  matching `@hypequery/datasets`. Duplicate-insensitive aggregates are allowed
  through `belongs_to` and every aggregate through `has_one`. Unmatched target
  rows never feed an aggregate, and target tenant and fixed-filter scoping are
  preserved. Catalogs, ordering and discovery advertise the safe names.
- Reject a query that selects one name as both a dimension and a measure.

- Add `having` conditions on selected measure values, matching
  `@hypequery/datasets` (HQ-329). Operators are `eq`, `neq`, `gt`, `gte`, `lt`,
  `lte`, `between`, `in` and `notIn`. Values are finite numbers bound as
  parameters, and conditions count against `max_filters`. Dataset endpoints
  forward `having`; metric endpoints refuse it. Queries with conditions bypass
  the result cache until the cache preimage carries them.
- Support composite relationship keys (RFC 0016), matching `@hypequery/datasets`.
  Pass `keys=(("customer_id", "id"), ("region_code", "region"))` to a
  relationship helper; every pair is AND-ed in the join, and related-measure
  projections keep every target key. Catalogs, semantic contracts and
  deployment contracts carry `keys`, and protocol validation accepts and checks
  them. Single-key relationships are unchanged.

- Align Python CLI names with TypeScript: `init --path`, `dev --hostname`, `-p`,
  `--no-watch`, `-V` and `help [command]`; preserve positional destinations,
  `--host` and `--no-reload` as aliases.
- Add framework-free `hypequery` and `python -m hypequery` CLI entry points,
  help/version and the `init`/`dev` command contract (PYE-01A).

- Add `hypequery init [directory]` with packaged Python project templates,
  authenticated orders endpoint, setup instructions and collision protection (PYE-01B).
- Inspect the configured ClickHouse schema during `hypequery init`, generate typed
  dataset definitions and a schema snapshot, and serve selected tables through
  authenticated endpoints. Match TypeScript's table selection and semantic naming;
  report unsupported columns, collisions and tenant candidates. Count nullable
  rows accurately. The offline demo requires `--skip-connection`.

- Add `hypequery dev [module:app]` with reload enabled by default, safe local
  runner policies, `--no-reload`, and actionable startup errors (PYE-01C).

- Gate Python CLI onboarding on wheel/sdist installs outside the checkout across
  Python 3.11–3.14, including a real authenticated ClickHouse query (PYE-01D).
- Verify schema-backed generation from installed wheel/sdist, serve discovered
  tables, and compare query results with raw ClickHouse SQL. Keep explicit offline
  example checks for base installations without driver extras.

- Align Python public authoring names with TypeScript: add `dataset`,
  `dimension.string/number/boolean/timestamp`, base `measure` helpers, `filter`
  and `order` namespaces, `create_memory_cache_store`, `create_api`, endpoint
  factories, `serve_dev`, and `start_server`. Existing
  constructors, callable dimension helpers and `run_dev` remain available; use the
  namespaces above for aggregation, filter, ordering and formula helpers.

- Add `hypequery generate datasets` (alias `generate:datasets`) using live ClickHouse
  metadata, with TypeScript-equivalent `--output`, `--path`, table selection, `--diff`,
  `--check`, `--force` and `--tenant-column` options. It defaults to `datasets.py`, matching the project
  layout created by `hypequery init`. Read-only drift checks exit 1 without writing;
  replacement is atomic and preserves the existing file's permissions. `--force`
  replaces the whole file and warns when it removes a configured `tenant_key`;
  `--tenant-column` sets `tenant_key` on tables that have that column and reports
  tables that do not.
- Reject destinations changed during discovery or writing, coordinate CLI writers
  through replacement, and accept concurrently created parent directories. Installed
  wheel/sdist journeys now restart serving and compare the regenerated column's query
  response with raw SQL.

- Add explicit synchronous and asynchronous relationship uniqueness checks. Checks respect trusted tenant scopes, deadlines and cancellation, validate complete composite target keys, and report duplicate to-one keys without automatically running database queries.

- Require aiohttp 3.14.4 or newer with the `clickhouse-async` extra, fixing three published advisories (CVE-2026-111063, CVE-2026-111064, GHSA-2g87-pp6c-29x5).

- Retry server-side `KILL QUERY` from the async executors until ClickHouse confirms it or the driver call returns. A cancellation or deadline that landed before the query registered on the server previously let the query run to `max_execution_time` while holding its worker slot; the synchronous executor already retried. `AsyncFromSyncClickHouseExecutor` keeps retrying for as long as its driver call runs, so a submission slower than `max_execution_time` cannot escape cancellation; the native async executor stops when its driver request ends if the server cancels read-only queries on a closed request (clickhouse-connect enables this whenever the user may change it), and otherwise at the server's own time limit. `aclose()` on either async executor stops its outstanding retries.

- The result cache treats a stored value that cannot answer the query as a reported `get` failure and a miss. That covers anything other than `CachedRows`, rows that don't match the columns, non-scalar values, and columns that differ from the query's. Previously a malformed value failed the request, and a well-formed entry with other columns was served as a hit. `ResultCache.get` accepts the expected `columns`.

- Canonicalize text containing unpaired UTF-16 surrogates as `JSON.stringify` does, writing a `\\udXXX` escape, instead of failing with a `UnicodeEncodeError`. Deployment and bundle contracts with such a label or description now produce the same canonical bytes as TypeScript.

- `hypequery init` and `hypequery generate datasets` now work for least-privilege ClickHouse users. Schema discovery sent `readonly = 1` on every catalog query, so a `readonly = 2` user failed with "Cannot modify 'readonly' setting" and a `readonly = 1` user was refused on the query limits. Discovery now follows the executor: it leaves out `readonly` for a user whose profile is already read-only, keeps the time and row limits for `readonly = 2`, and relies on a SQL `LIMIT` for `readonly = 1`, which may not change any setting.
- When discovery fails, `init` and `generate` now name what to check, as `dev` does: credentials, host and port, database, or grants. Previously every failure gave one generic message.

- `hypequery dev` keeps its documented exit codes: a busy port now exits 1 with a hint naming the port, instead of exiting 3. A missing environment variable, such as `HYPEQUERY_DEV_TOKEN`, is named instead of reported as a generic failure. ClickHouse driver warnings, such as "Unexpected Http Driver Exception" and urllib3 retry lines that can include bound parameter values, no longer print ahead of the CLI's own hint.
- `hypequery init` prints `cd <directory> && hypequery dev` when the project was created somewhere else. The generated `.env.example` lists `CLICKHOUSE_SECURE`. The `export client-contract --check` hint now says to review with `--stdout` and replace with `--force`.

- Canonicalize client-contract numbers beyond 2**53 with ECMAScript's shortest round-trip digits, matching TypeScript's `JSON.stringify`. Contract identities and schema hashes containing such a value no longer differ between the two implementations.

- `serialize_semantic_contract` and `hash_contract` no longer raise `UnicodeEncodeError` when a label or description contains an unpaired UTF-16 surrogate. Such a character is escaped as `\udXXX`, as `JSON.stringify` does, so the hash matches TypeScript's for the same model. `hypequery.protocol` now exports `serialize_protocol_string`.

- Lower the dependency floors to measured minimums: pydantic 2.9.2, FastAPI 0.137.2, Starlette 1.3.1, Uvicorn 0.30.6 and clickhouse-connect 1.4.2 (urllib3 stays at 2.8.0). Each is the oldest release that passes the full suite, so `hypequery` installs next to projects that pin older releases of those libraries.

- Add `validate_deployable(dataset)`, which refuses derived measures the deployment contract cannot carry (a reference to another derived measure, or a literal anywhere other than `round` decimals or a `coalesce` fallback) with an error naming the dataset and measure, for example `orders.doubled: a numeric literal cannot be an arithmetic operand in a deployable formula`. `build_protocol_deployment_contract()` and `write_dataset_bundle()` run the check first instead of failing with only a contract path.

- Order time buckets by their instant rather than their text label. On a daylight-saving fall-back day, two hourly buckets share a label such as `01:00:00`, and they could come back in either order. TypeScript already orders them chronologically.

- The `embedded_analytics` example is now tenant-scoped. Its dataset declares `tenant_key="org_id"`, the endpoint requires a tenant, and the example token belongs to organization "a". Previously every caller saw every organization's orders.

- Served dataset and metric endpoints no longer expose related datasets' fields by default. Previously a caller refused by the shipments endpoint could still read `shipment.carrier` through the orders endpoint, and the client contract advertised those fields. Related dimensions, related measures, and named filters defined on a related field now need `include_related={"shipment"}` on `create_dataset_endpoint`, `add_dataset_endpoint` or the metric equivalents. Without it, they are refused with `400 VALIDATION_ERROR` and left out of the endpoint's client contract. So are measures whose fixed filters read a related field, directly or through a derived measure; an omitted `measures` list selects only the base measures the endpoint can serve, and a metric endpoint for such a measure is refused when created. `ClientEndpointDefinition` gains `related` for the same purpose, with the same default and checks, so an offline `hypequery export client-contract` matches the live contract of an endpoint installed with the same arguments. Pass `related={"shipment"}` where the endpoint passes `include_related={"shipment"}`; an offline metric whose measure filters through an excluded relationship is refused, as Serve refuses it.

- Report a filter, ordering or having field name outside the portable identifier grammar as an `input-invalid` query error from `DatasetClient.validate` and `execute`. It previously escaped as a raw `ProtocolIdentifierError` (a `TypeError`), which non-Serve hosts answered as a server fault.

- Add `control_username` and `control_password` to `ClickHouseConnection`, read from `CLICKHOUSE_CONTROL_USERNAME` and `CLICKHOUSE_CONTROL_PASSWORD` by `from_env()`, so the connection that sends `KILL QUERY` can sign in as its own user. Without them, the query user cancels its own queries and needs `GRANT SELECT ON system.processes`; a separate control user also needs `KILL QUERY`. The README now documents both grants.
- When ClickHouse refuses a `KILL QUERY`, executors now log one error naming the missing grant and stop retrying, instead of sending a warning and dozens of refused `KILL`s per cancelled query.

- `validate_protocol_client_query(..., transport="mcp")` refuses a `limit` above the endpoint's `maxLimit` instead of clamping it, matching TypeScript's MCP executor. HTTP input still clamps.

- Return `null` for non-finite measure values instead of failing the query. ClickHouse reports `nan` for `avg`, `stddev` and `variance` over no matching rows and `inf` for a derived division by zero; such results previously surfaced as an internal error, so a metric endpoint whose filters matched nothing answered 500.

- Refuse integer filter values outside ±2**53 on number fields with `input-invalid`. Number filters bind as `Float64`, which can't hold larger integers exactly, so ClickHouse compared a rounded value and an exact `UInt64` or `Int64` id silently matched nothing. Declare a large id as `dimension.string()` to filter it exactly.

- Ship the Apache-2.0 `LICENSE` file in the wheel and sdist, and leave a stale internal review document out of the sdist.
- Raise transitive minimum versions that the direct floors still admitted with published advisories: `h11>=0.16.0` (via uvicorn) and `anyio>=4.14.2` (via Starlette) in the `fastapi` extra, `certifi>=2026.10.19` (via clickhouse-connect) in both ClickHouse extras, and `idna>=3.15` (via anyio and aiohttp) in the `fastapi` and `clickhouse-async` extras.
- `create_async_clickhouse_executor` now raises `ModuleNotFoundError` naming `hypequery[clickhouse-async]` when aiohttp is missing. With only `hypequery[clickhouse]` installed, it previously failed with an opaque `internal` error.
- Rewrite the README's beta notice for PyPI, where the old relative link was broken. Document what each install extra is for, including `clickhouse-async`.

- `hypequery dev` now says which ClickHouse setting to check when the app cannot connect: refused credentials, an unreachable host, a missing database or denied access each get their own hint instead of "App could not start". Wrong-password failures, which ClickHouse reports as `REQUIRED_PASSWORD`, `WRONG_PASSWORD` or `UNKNOWN_USER`, are now classified `unauthenticated` rather than `internal`, and an unknown database is `not-found`.
- A ClickHouse user whose profile sets `readonly = 1` refuses HypeQuery's per-query limits; that failure is now reported as `forbidden` with guidance to use a `readonly = 2` user instead of an opaque internal error.
- `Deadline` is exported from `hypequery.datasets` so an `ExecutionContext` deadline can be built from the public package.
- Passing a dataset name instead of a `Dataset` to `belongs_to`, `has_one` or `has_many` raises a `TypeError` that says so, instead of an `AttributeError`.
- `AsyncFromSyncClickHouseExecutor` no longer leaves "Future exception was never retrieved" in the logs when a caller cancels a query.
- README: the relationship example names the physical `customer_id` column (join keys are columns, not dimensions), the result cache documents a store failure as a `miss`, and the bridge executor documents the session-free driver clients it needs.

- Report a query that exceeds its result limit as `too-large` (HTTP 413) on ClickHouse 26, which renamed the error to `TOO_MANY_ROWS_OR_BYTES` (code 396). It was reported as `internal` (HTTP 500).

- Exclude the Hypothesis example database from source distributions and refuse archives that contain one in the release artifact audit.

- Serve routes now map Starlette's `HTTPException` like FastAPI's, keeping its status and string `detail`. They previously returned `500` for it, and FastAPI raises it itself for a body it cannot parse. So a body with invalid UTF-8, or one nested past the recursion limit, now gets `400 VALIDATION_ERROR` instead of `500`, without logging a traceback.
- Serve routes refuse a request body with any `Content-Encoding` other than `identity` with `415`. A gzip body previously got `500`. The body cap counts bytes as they arrive, so a compressed body is never expanded.

- Fix Serve requests that could hang until the client gave up, or until the production timeout (30 s by default), after the query had already finished. The request's disconnect watcher is now stopped with a flag rather than `Task.cancel()`, which Starlette's `Request.is_disconnected()` could absorb. The stall hit sequential requests too, and became frequent under concurrency or host load: about 60% of requests at 50 concurrent.

- Refuse timestamp filter values that are not a real ISO 8601 date or date-time, such as `2026-13-45`, `2026-02-30`, `yesterday` or `2026-01-31 12:00`, with `input-invalid` naming the filter. ClickHouse coerced some of these to a different instant instead of failing: `2026-13-45` became 1900-01-01 and `2026-02-30` rolled over to March 2, so the query silently returned wrong numbers. `validate()` now reports them too. Accepted forms are `YYYY-MM-DD`, or `YYYY-MM-DD[T ]hh:mm:ss[.fraction]`, optionally followed by `Z` or `±hh:mm`. `like` patterns on timestamp fields are unchanged.

- Require pydantic 2.12.2 or newer on Python 3.14. pydantic-core publishes no Python 3.14 wheel for the previous 2.9.2 floor, and pydantic 2.12.0 rejects one of the serve request models on 3.14. Python 3.11–3.13 keep the 2.9.2 floor.

- The README that `hypequery init` generates installs the pinned SDK from PyPI with `pip install -e .`, keeping the local-wheel route for unreleased builds.

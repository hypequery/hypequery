# Changelog

## Unreleased

- Add `hypequery dev [module:app]` with reload enabled by default, safe local
  runner policies, `--no-reload`, and actionable startup errors (PYE-01C).
- Add `hypequery init [directory]` with packaged Python project templates,
  authenticated orders endpoint, setup instructions and collision protection (PYE-01B).
- Add framework-free `hypequery` and `python -m hypequery` CLI entry points,
  help/version and the `init`/`dev` command contract (PYE-01A).
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
- Bind timestamp parameters as Unix seconds. RFC 3339 filter values such as
  `2026-10-25T01:30:00Z` were rejected by ClickHouse, and aware datetimes could
  resolve to the wrong instant on a non-UTC server in a repeated daylight-saving
  hour. Values without an offset are passed through unchanged.
- Align Python CLI names with TypeScript: `init --path`, `dev --hostname`, `-p`,
  `--no-watch`, `-V` and `help [command]`; preserve positional destinations,
  `--host` and `--no-reload` as aliases.

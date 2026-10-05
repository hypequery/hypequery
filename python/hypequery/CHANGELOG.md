# Changelog

## Unreleased

- Select one-hop relationship base measures as `<relationship>.<measure>`,
  matching `@hypequery/datasets`. Duplicate-insensitive aggregates are allowed
  through `belongs_to` and every aggregate through `has_one`. Unmatched target
  rows never feed an aggregate, and target tenant and fixed-filter scoping are
  preserved. Catalogs, ordering and discovery advertise the safe names.
- Reject a query that selects one name as both a dimension and a measure.
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

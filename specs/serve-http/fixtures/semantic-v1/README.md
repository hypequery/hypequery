# Semantic HTTP fixtures v1

`cases.json` runs against TypeScript `createAPI` and Python's FastAPI application.
Both fixture apps author the same dataset from `app`, execute over its deterministic
positional rows, and actually apply the generated LIMIT/OFFSET. Cases pin selected
wire data, paging, caps, measure serialization, metadata opt-in, canonical failure
types, authentication/role/scope/tenant denials, and the exact logical discovery
projection. Recursive public-key checks prevent SQL, physical, tenant and diagnostic
fields from being silently added. Dynamic request IDs and timings are checked by
shape, not compared as literals. Cache metadata is optional for uncached
TypeScript dataset queries; when reported, these fresh fixture apps must report
a cache miss.

`pnpm conformance:serve` runs this suite and errors-v1 in both languages. Python
quality jobs run it on 3.11–3.14 and the FastAPI-floor job includes it. Fixtures
are Turbo test inputs, so edits invalidate TypeScript test caches.

Coverage is HTTP behavior over recording executors, not a live ClickHouse test.
Python runs every shared case with and without its `ProductionProfile`. Its
runtime-specific startup, admission, response byte ceiling, cancellation and
real Uvicorn process tests live in `test_serve_production.py`; live ClickHouse CI
also exercises a production HTTP dataset query. These process settings are
Python-specific, not a shared Node/ASGI configuration contract. Python metric
coverage is measure-backed endpoints, not formula metric definitions.

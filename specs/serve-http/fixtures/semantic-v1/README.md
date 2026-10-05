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
ASGI process settings and their cross-implementation cases follow PYD-06; do not
interpret this suite as qualification of a production process profile. Python
metric coverage is measure-backed endpoints, not formula metric definitions.

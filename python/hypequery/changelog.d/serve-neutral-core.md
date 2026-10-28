- Internal refactor, no API or wire change: `hypequery.serve` now runs its
  dataset, metric, discovery and client-contract routes through a
  framework-neutral core (`hypequery.serve.core`, decision 0023 step 1). The
  core owns authentication before the body is read, the body policy, request
  ids, strict client-contract validation and the error envelope. FastAPI routes
  delegate to it, and OpenAPI docs and responses are unchanged. The core is
  internal until a later release makes it public.

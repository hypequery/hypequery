- Internal refactor, no API or wire change: the HTTP security profile now lives
  in the framework-neutral serve core (decision 0023 step 2). Trusted hosts,
  proxy trust, CORS, request ids, route rate limits and production budgets are
  implemented once in `hypequery.serve.core`; `Api.handle` applies them, and the
  FastAPI middleware and `RateLimit` dependency call the same code. Responses
  are byte-for-byte unchanged.

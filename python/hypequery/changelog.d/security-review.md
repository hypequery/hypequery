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

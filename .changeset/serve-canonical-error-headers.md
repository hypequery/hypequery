---
"@hypequery/serve": patch
---

Every error response is now sent with `Cache-Control: no-store`, so a shared cache can never replay one caller's error to another. Previously only 401 and 403 responses set it.

The Node adapter no longer returns a thrown error's message in its fallback 500 response. It now answers `An unexpected error occurred`, because an error that escapes the pipeline can carry a stack, a file path, SQL, or a driver detail. The adapter's own 413, 500, and 504 responses now also carry `x-request-id` and `Cache-Control: no-store`.

The error envelope is pinned by the language-neutral `specs/serve-http` fixtures, which the Python serve also runs.

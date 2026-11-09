---
"@hypequery/serve": minor
---

TypeScript serve APIs can now export a client contract and enforce its schema pin.

- `api.clientContract()` returns the build view of every dataset endpoint and measure-backed metric endpoint, with full paths and schema hashes. `hypequery generate:client` turns it into typed React hooks for a frontend in another repository. Set `clientContract: { mountPath }` when the API is mounted below a prefix. Each `datasets` and `metrics` key must be the dataset's or metric's own name. Metrics with a fixed grain (`metric.by(grain)`) aren't advertised.
- A request that sends `X-Hypequery-Client-Schema` is checked before input validation. A stale hash gets `409 VALIDATION_ERROR` with `details.code: 'CLIENT_SCHEMA_CHANGED'`. A matching hash runs under the strict client profile, and its response metadata is limited to `requestId`, `timingMs`, `rowCount`, `pagination` and `cache.hit`, as in Python. Requests without the header behave as before.
- The default CORS allow-headers now include `X-Hypequery-Client-Schema`.

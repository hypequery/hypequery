---
"@hypequery/serve": minor
"@hypequery/react": minor
---

Add a route manifest to bridge serve and react for metric/dataset endpoints.

`@hypequery/serve` now exposes `api.manifest()` (and `ServeBuilder.manifest()`),
a serializable map of every query/metric/dataset key to its `{ method, path }`
(full path, including the base path; datasets keyed as `dataset:<name>`).

`@hypequery/react`'s `createHooks`/`createAnalyticsHooks` accept a `manifest`
option to resolve client routes without importing server code into the bundle.
This fixes metric/dataset hooks (POST routes whose paths differ from their map
keys) silently defaulting to `GET {baseUrl}/{key}`. Hooks now also derive routes
from a runtime `api` object via `api.manifest()`, and throw a clear error when a
semantic (`dataset:`) key has no resolved route instead of calling the wrong URL.

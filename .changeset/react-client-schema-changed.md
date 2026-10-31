---
"@hypequery/react": minor
---

Requests from a generated client that the server refuses with `409 CLIENT_SCHEMA_CHANGED` now throw `ClientSchemaChangedError`, a subclass of `HttpError`, whose message says to regenerate the client.

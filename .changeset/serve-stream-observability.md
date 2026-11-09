---
"@hypequery/serve": patch
---

Streamed responses are now observable to the end. `onRequestEnd` and the query log's `completed` event fire when a stream finishes (or the client abandons it) rather than when it opens, with the full `durationMs` and a new `stream` field (`outcome`, `bytes`, `openDurationMs`). A failure after the response began — an NDJSON stream that ended with its `error` frame, an Arrow stream that broke off, or a stream the server timed out — now reaches `onError` and an `error` log event with the original error; the client still sees only the sanitized frame. Custom handlers can report an in-band failure with `streamBody(stream, contentType, { failure })`.

The Node adapter bounds streams with `streamIdleTimeout` (no bytes sent for this long; defaults to `requestTimeout`) and `streamTimeout` (total, default unlimited); a stream that exceeds either is cancelled, stopping its query, and the connection closed. `Accept` q-values now decide between a JSON page and a stream (`application/json;q=1, application/x-ndjson;q=0.1` gets a page). Streaming-capable dataset endpoints send `Vary: Accept`, combined with any CORS `Vary: Origin`. The fetch adapter no longer sends two content types when custom headers set `Content-Type`.

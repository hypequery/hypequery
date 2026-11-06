# Streaming HTTP fixtures v1

`cases.json` pins what a dataset endpoint that opts into streaming sends, in
every language that serves datasets. The fixture app authors one dataset from
`app` over deterministic rows, streamed in batches of `batchSize`, with a page
cap of `pageCap` rows and a stream cap of `streamMaxRows`.

A request asks for a stream with `Accept`:

- `application/x-ndjson`: one JSON frame per line. `start` comes first (with
  `meta` only when requested), then one `rows` frame per non-empty batch with the
  rows a JSON page would hold, then `end` with `rowCount`. A query that fails
  after the response began ends with an `error` frame carrying the standard error
  envelope instead; a response without `end` is incomplete. Error frames never
  carry the driver's or the database's text.
- `application/vnd.apache.arrow.stream`: the Arrow IPC stream the dataset client
  produced, byte for byte. A failure partway breaks the connection, so the
  stream lacks its end-of-stream marker.

An endpoint that does not stream, or a request that does not ask (or refuses a
stream type with `q=0`), gets the JSON page it always got. Failures before the
first byte (validation, authentication) are ordinary JSON error responses with
their status. Streamed responses are `cache-control: no-store`.

Cases compare concatenated rows, not batch boundaries, except where `batches`
pins the count. TypeScript runs them in `serve-streaming-fixtures.test.ts`.

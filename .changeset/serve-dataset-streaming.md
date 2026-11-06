---
"@hypequery/serve": minor
---

Dataset endpoints can stream their results. Opt an entry in with `stream: true` or `stream: { maxRows }` (default `maxLimit`, at most the dataset's `limits.maxResultSize`); a request then asks with `Accept: application/x-ndjson` for row batches as NDJSON frames (`start`, `rows`…, then `end` with `rowCount`, or an `error` frame if the query fails after the response began) or `Accept: application/vnd.apache.arrow.stream` for an Arrow IPC stream. Streams keep the endpoint's auth, tenant isolation and validation, are never cached, and stop the query when the client disconnects. Endpoints without `stream`, and requests that don't ask, get the usual JSON page. Custom handlers can stream any body by returning `streamBody(stream, contentType)`; the Node and fetch adapters write it with backpressure. `NDJSON_MEDIA_TYPE` and `ARROW_STREAM_MEDIA_TYPE` are exported.

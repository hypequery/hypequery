- Dataset endpoints can stream their results. With
  `EndpointPolicy(stream_max_rows=...)` (at most the dataset's
  `max_stream_rows`, else `max_result_size`), a request that asks with
  `Accept: application/x-ndjson` gets row batches as NDJSON frames (`start`,
  `rows`…, then `end` with `rowCount`, or an `error` frame if the query fails
  after the response began), and `Accept: application/vnd.apache.arrow.stream`
  gets an Arrow IPC stream, frame for frame as TypeScript serve sends them.
  Streams keep the endpoint's auth, tenant scope and validation, are never
  cached, and stop the query when the caller goes. They need `to_asgi_app`;
  WSGI, Django views and Flask answer with the usual page. Under a
  `ProductionProfile` a stream holds its slot, runs within `timeout_seconds`
  and stops at `max_result_bytes`: NDJSON with a `PAYLOAD_TOO_LARGE` frame,
  Arrow broken off before its end-of-stream marker.

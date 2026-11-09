- Serve sends a dimension integer beyond ±(2^53 − 1), such as a `UInt64` id,
  as a string in JSON pages and NDJSON stream frames, so JavaScript clients
  (React hooks, `fetch`, MCP clients) no longer round it. Smaller integers stay
  numbers, and local Python client results keep native `int`s.

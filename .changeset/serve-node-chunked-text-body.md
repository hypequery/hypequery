---
"@hypequery/serve": patch
---

Node adapter: a JSON request body left as text by `express.text()` is parsed again when it was sent chunked or compressed, instead of reaching the endpoint as a raw string. When no length can be compared, a string body that is JSON object or array text is parsed and any other string is kept as a string, so a decoded `"123"` stays `"123"`. As a result, a chunked or compressed `express.text()` body that is a bare JSON primitive (`123`, `true`, `null`) reaches the endpoint as a string; send such bodies with a `Content-Length`, or parse them with `express.json()`. And a JSON string decoded by `express.json({ strict: false })` is held to `bodyLimit`.

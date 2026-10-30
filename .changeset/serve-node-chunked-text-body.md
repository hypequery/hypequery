---
"@hypequery/serve": patch
---

Node adapter: a JSON request body left as text by `express.text()` is parsed again when it was sent chunked or compressed, instead of reaching the endpoint as a raw string, and a JSON string decoded by `express.json({ strict: false })` is held to `bodyLimit`.

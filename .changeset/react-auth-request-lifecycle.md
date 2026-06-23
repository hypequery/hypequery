---
"@hypequery/react": minor
---

Support authenticated request lifecycles in generated React hooks.

The `headers` callback may now be asynchronous and is resolved for every
request, allowing short-lived credentials to be supplied. A new
`onUnauthorized` callback can refresh credentials after a 401 response; the
request is then retried once with freshly resolved headers.

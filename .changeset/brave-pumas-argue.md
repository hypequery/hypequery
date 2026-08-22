---
"@hypequery/serve": patch
---

`api.manifest()` now reports routes registered with `api.route()` instead of the
auto-generated convention route.

`route()` registers the endpoint with the router but leaves `queryEntries`
holding the auto-registered `/queries/<key>` entry, and `manifest()` read from
`queryEntries`. So an endpoint registered as:

```ts
api.route('/busiest-routes', api.queries.busiestRoutes, { method: 'POST' });
```

appeared in the manifest — and therefore in `hypequery generate:manifest` output
— as `GET /queries/busiestRoutes`. `@hypequery/react` follows the manifest, so
`useQuery('busiestRoutes', { limit: 8 })` issued a GET the server rejected with a
400 rather than calling the POST route the author declared.

Both routes remain live; the manifest can only name one, and it now names the
explicit registration. When an endpoint is routed more than once the first
registration wins, so regenerating the manifest is deterministic.

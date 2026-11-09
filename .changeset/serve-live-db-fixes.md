---
"@hypequery/serve": patch
---

Fix four issues found running serve against a live ClickHouse:

- `createFetchHandler` (and the Vercel edge handler and Next.js mounts built on it) threw `Invalid response status code 204` on CORS preflight requests. Responses with 204, 205, and 304 now have no body.
- `serve({ metrics })` and `serve({ datasets })` threw "`queryBuilder` is required" when the builder came from `context: () => ({ db })`, the form the docs lead with. Semantic endpoints now use each request's `ctx.db`. A request whose context returns no `db` fails instead of using another request's builder.
- `tenant: { column }` without `mode` silently skipped tenant filtering, because `mode` defaulted to `'manual'`, which ignores `column`. Setting a `column` now defaults `mode` to `'auto-inject'`. Pass `mode: 'manual'` to keep filtering in your own queries.
- `createAnalyticsTokenIssuer` could not mint scopes, so its tokens never satisfied `requiredScopes`. It now accepts `scopes` and writes them as the standard `scope` claim.

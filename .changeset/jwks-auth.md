---
"@hypequery/serve": minor
"@hypequery/react": minor
---

Add built-in JWKS JWT auth and client token-refresh.

`@hypequery/serve` adds `createJwksStrategy` — verifies bearer JWTs against a
remote JWKS (Auth0/Clerk/Cognito/etc.) or a static `jwks` key set. It lazily
loads the optional `jose` peer dependency on first use and caches the key set, so
it adds nothing to startup or to apps that don't use it. Verified claims map to
the auth context (configurable via `mapClaims`); missing tokens throw `MISSING`
(or resolve to `null` when `optional`), and invalid/expired tokens throw
`INVALID`. The serve README also documents using a shared `RateLimitStore` (e.g.
Redis) for multi-instance deployments.

`@hypequery/react`: `createHooks`/`createAnalyticsHooks` now accept an async
`headers` function (resolved per request, so it can supply a fresh token) and an
`onUnauthorized` callback that refreshes credentials on a `401` and retries the
request once.

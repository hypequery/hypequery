---
"@hypequery/serve": minor
"@hypequery/cli": patch
---

Allow trusted in-process hosts to provide an already-authenticated principal to
Serve execution, and forward that principal through deployment runtime
artifacts while retaining role, scope, and tenant enforcement.

`api.execute()` (and `client()` / `run()`) now accept a `trustedAuth` option.
Supplying it skips credential parsing only; required roles and scopes, tenant
extraction, the context factory, validation, middleware, hooks, and
`cache-control: no-store` all still apply. It is unreachable from the HTTP
handler, so a network caller cannot set it. Pass `null` or omit it to fall
through to the configured auth strategies.

Because the principal is what authorization ran against, the pipeline now owns
`ctx.auth` and `ctx.tenantId`. Two behavior changes follow:

- A caller-supplied `context` containing `auth` or `tenantId` is rejected with a
  `VALIDATION_ERROR` instead of being merged over the authenticated principal.
- A context factory returning `auth` no longer replaces the authenticated
  principal on `ctx.auth`.

Deployment runtime artifacts refuse a `trustedAuth` argument when the bundled
module exposes no Serve `execute()` pipeline, rather than running the handler
with no enforcement.

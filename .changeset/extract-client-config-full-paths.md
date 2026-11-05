---
"@hypequery/serve": patch
---

Fix `extractClientConfig(api)` returning paths without the API's base path and ignoring `api.route(...)` overrides (for example `/queries/hello` instead of `/api/analytics/queries/hello`), which sent React hooks configured from it to URLs that 404. It now returns the same routes as `api.manifest()`. `extractClientConfig` is deprecated in favour of `api.manifest()`, which `@hypequery/react` accepts directly as `manifest`.

---
"@hypequery/serve": patch
---

Make `context` optional in `initServe`, matching the runtime (which already
defaults a missing context to `{}`) and the documented auth-only usage. When
omitted, query context is typed as `Record<string, unknown>`.

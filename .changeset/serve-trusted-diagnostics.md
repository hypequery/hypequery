---
"@hypequery/serve": patch
---

Omit SQL and internal tenant IDs from caller-requested dataset and metric
metadata by default. Public metadata remains available through includeMeta or
x-include-meta. Trusted endpoints can explicitly retain diagnostics with the
server-side trustedDiagnostics option; protect those endpoints with auth and roles.

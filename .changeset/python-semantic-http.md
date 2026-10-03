---
"@hypequery/serve": minor
---

Add authenticated logical `/discovery` with configurable endpoint policy. Public dataset and metric metadata now contains only operational fields; SQL and tenant details require host authorization and auditing and are returned separately under `diagnostics`. The existing `/contract` keeps its version and definition hash while omitting physical and tenant-policy fields. Applications needing the full contract should use local `serializeSemanticContract`.

Pin semantic HTTP behavior against the same fixtures as Python serve.

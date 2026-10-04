---
"@hypequery/datasets": minor
"@hypequery/serve": patch
"@hypequery/react": patch
---

Preserve dataset filter allowlist names and field-specific operators through dataset and metric queries, Serve API inputs, and React hooks. Generated filters respect `filterable: false`, and one-hop relationship filters follow the target allowlist. Filter helpers retain operator literals.

Prevent normal dataset execution from falling through to the legacy dynamic-query overload; explicit result-row generic calls remain supported. Fix Serve in-process execution input inference so its optional schema storage property no longer widens typed inputs to unknown.

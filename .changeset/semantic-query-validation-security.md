---
"@hypequery/datasets": patch
---

Reject unsupported semantic filter operators and invalid sort directions at
runtime, including direct SDK inputs, before compilation or cached execution.
Render sort directions through a closed mapping instead of interpolating input.

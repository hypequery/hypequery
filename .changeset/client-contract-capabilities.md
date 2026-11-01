---
"@hypequery/datasets": patch
---

`buildClientContract` no longer advertises `having` predicates or a per-request `timezone` by default. A deployment runs on the portable semantic query, which supports neither, so a generated client could send them and have them ignored, returning unfiltered rows. Hosts that do execute them opt in with `capabilities: { having: true, timezone: true }`.

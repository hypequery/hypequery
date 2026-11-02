---
"@hypequery/datasets": minor
---

`buildClientContract` no longer advertises `having` predicates or a per-request `timezone` by default. A deployment runs on the portable semantic query, which supports neither, so a generated client could send them and have them ignored, returning unfiltered rows. Hosts that do execute them opt in with `capabilities: { having: true, timezone: true }`.

Both flags are part of each endpoint's hashed schema, so upgrading moves the `schemaHash` of every endpoint with a time field or a numeric measure. Regenerate clients (`hypequery generate:client`) after upgrading; until then `generate:client --check` reports drift, and a host that validates requests against the new contract refuses an old client's `timezone` instead of ignoring it.

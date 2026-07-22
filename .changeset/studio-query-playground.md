---
'@hypequery/studio': minor
'@hypequery/gateway': patch
---

Add an interactive query playground to the studio (the default **Playground** tab; Runs moves beside it). Pick a dataset from the registry, toggle dimension/measure chips, build filter rows (field/operator/value; `in`/`notIn` accept comma-separated lists; numbers and booleans are coerced), set a limit, and run — the query goes through the real serve `/execute` pipeline (auth/tenant/validation included) and renders as a result table with duration and row-count badges. Pickers are driven entirely by the JSON Schemas serve already publishes per dataset, so no new gateway surface is required.

Also fixes a gateway contract bug: registry keys for dataset endpoints were not executable (serve's `describe()` reports the internal name while execution registers `dataset:<name>`). The gateway now normalizes dataset registry keys to their executable form.

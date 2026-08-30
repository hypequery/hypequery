---
"@hypequery/cli": patch
---

Stop dataset scaffolding from automatically enabling tenant isolation based on column-name heuristics. Generated files and CLI output now present every possible tenant key for explicit review instead.

Add `generate:datasets --tenant-column <column>`, which sets `tenantKey` on every table that has the column. `hypequery init --auth context` uses it for the scaffold it generates and prints the matching regeneration command, so refreshing a tenant-scoped project no longer drops `tenantKey`.

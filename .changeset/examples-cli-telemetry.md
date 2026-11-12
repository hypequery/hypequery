---
'@hypequery/cli': patch
---

Instrument `hypequery examples list` and `hypequery create` telemetry. `examples` now reports the kind filter, table or JSON output, and a bucketed entry count. `create` reports which public registry entry was scaffolded (any slug outside the registry is recorded as `other`, never as typed), its kind and language, the stage reached or failed (resolved, fetched, pinned, installed, completed), whether the seed was copied, whether any pin fell back to a dist-tag, and whether the dependency install succeeded, failed or was skipped. Cancelling the directory prompt now exits 130 as `cancelled` instead of failing. The website telemetry proxy schema must be deployed before this release, or the new properties are rejected.

`hypequery create` now removes a Python example's monorepo `uv.lock` along with its `[tool.uv.sources]` table, so uv resolves `hypequery` fresh from PyPI. Previously the stale lock kept `hypequery` at 0.1.0b3, which has no `mcp` extra, and `mcp-agent-analytics-python` failed with `No module named 'mcp'`.

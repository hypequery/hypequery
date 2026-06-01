---
"@hypequery/cli": patch
"@hypequery/mcp": patch
"@hypequery/schema": patch
---

Prepare the datasets semantic-layer launch path for release.

- Fix generated dataset measures so `generate:datasets` emits public `@hypequery/datasets` API calls that compile.
- Add the default migration lock-table setting to schema config resolution.
- Fix MCP stdio startup/runtime compatibility by resolving the MCP SDK's AJV 8 dependency path and keeping logs off stdout.

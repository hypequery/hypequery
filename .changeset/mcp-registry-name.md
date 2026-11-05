---
"@hypequery/mcp": patch
---

Add `mcpName` (`io.github.hypequery/hypequery`) to the package manifest and a `server.json`, so the server can be published to the official MCP Registry. The build and the release version step write the package version into `server.json`, since the registry verifies `mcpName` against the npm release it names. No runtime change.

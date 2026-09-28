---
"@hypequery/cli": minor
---

`hypequery deploy` now prints where the deployment is served: the REST base URL, each dataset's URL, and the MCP URL, as reported by Cloud. `--mcp-config` also prints MCP client configuration that reads the key from `${HYPEQUERY_API_KEY}` and never contains a credential. `hypequery mcp --self-test --url <mcp-url>` checks a hosted MCP endpoint without calling a tool, reading the key from `HYPEQUERY_API_KEY`. `hypequery mcp --self-test` now fails when `@hypequery/mcp` isn't installed; before, it passed and the real command then failed.

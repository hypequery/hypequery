---
'@hypequery/cli': patch
---

`hypequery mcp <file>` and `hypequery dev <file>` now work from any working directory. TypeScript entries are bundled into `.hypequery/tmp` beside the entry's nearest `package.json` instead of the current directory, so imports like `@hypequery/serve` resolve from the entry's project. `hypequery mcp` also loads `@hypequery/mcp` from that project, so desktop MCP clients can launch `npx -y @hypequery/cli mcp /absolute/path/to/analytics/api.ts` without changing directory first.

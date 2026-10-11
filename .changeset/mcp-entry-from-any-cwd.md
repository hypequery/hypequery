---
'@hypequery/cli': patch
---

`hypequery mcp <file>` and `hypequery dev <file>` now work from any working directory. TypeScript entries are bundled into `.hypequery/tmp` beside the entry's nearest `package.json` instead of the current directory, so imports like `@hypequery/serve` resolve from the entry's project. The entry project's `.env*` files are loaded before the entry runs, so a generated client finds its ClickHouse settings; variables already set in the environment or the launch directory's env files keep precedence. `hypequery mcp` also loads `@hypequery/mcp` from that project, so desktop MCP clients can launch `npx -y @hypequery/cli mcp /absolute/path/to/analytics/api.ts` without changing directory first.

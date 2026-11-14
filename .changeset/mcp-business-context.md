---
"@hypequery/mcp": minor
---

`createMCPExecutor({ businessContext })` gives agents the project's reviewed business context (from `defineBusinessContext`): `list_datasets` carries it (only the summary, with `truncated: true`, when it is over 32 KB) and a new `get_business_context` tool returns all of it. Without `businessContext`, the tools and their output are unchanged. `formatBusinessContext()` renders a context as Markdown for a system prompt.

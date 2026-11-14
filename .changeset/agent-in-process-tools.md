---
"@hypequery/agent": minor
---

`hypequeryTools({ executor })` runs the hypequery tools in your own backend: pass an executor such as `createMCPExecutor({ datasets, analytics, tenantId })` from `@hypequery/mcp` and the AI SDK, Anthropic and OpenAI Agents adapters call it in process, with no endpoint, token or network hop. `tools` restricts the set by name. `createInProcessToolsClient` is the client behind it. Passing a bare executor where a client is expected now throws a `TypeError` that names `{ executor }`, instead of returning unparsed results.

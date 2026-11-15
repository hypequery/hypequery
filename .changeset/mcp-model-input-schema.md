---
"@hypequery/mcp": patch
---

`query_dataset` and `query_metric` now advertise an input schema that Claude, OpenAI and other model APIs accept: valid JSON Schema draft 2020-12, one object with no top-level `anyOf`, `oneOf` or `allOf`, listing every dataset's fields with each option labelled by the datasets it belongs to. Before, an MCP client that forwards schemas unchanged, such as Claude Code, dropped `query_dataset` without any error. The server still validates every call against the exact per-dataset schema and returns a correctable `MCP_INVALID_ARGUMENTS` error, and the manifest hash is unchanged. A query tool with nothing under it (no named metric, or no directly queryable dataset) is no longer listed, so agents stop spending calls on a tool that rejects every input.

A rejected query argument now says what is offered instead. The local server reports the problem in the dataset the call named (for example `dimensions.0: Invalid input: expected "device"`) instead of `arguments: Invalid input`, and lists the datasets when none matches. The client-contract bridge adds the names the endpoint accepts at that pointer (`Invalid client query at /dimensions/0. Offered by "orders": "amount", "country".`). Messages name only what the tool already offers, never a submitted value or key.

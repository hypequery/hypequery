---
"@hypequery/agent": patch
---

The AI SDK, Anthropic and OpenAI Agents adapters now give the model an input schema with no `anyOf`, `oneOf` or `allOf` at the top level. Anthropic's API rejected `query_dataset`'s schema, which has one variant per dataset, so every chat on an Anthropic model failed before the first token. The variants merge into one object schema; the server still validates each call against the exact schema and returns a correctable error.

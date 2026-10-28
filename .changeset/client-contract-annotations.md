---
'@hypequery/protocol': minor
'@hypequery/mcp': minor
'@hypequery/cli': minor
---

Client contracts can carry an optional `annotations` member per endpoint: the
dataset group's `label`/`description` and per-dimension/measure `fields` text
(RFC 0018 amendment). Text follows the deployment contract's rules (non-blank,
no control characters, at most 4096 UTF-8 bytes) and is excluded from
`schemaHash`, so rewording a description never trips the execution-time schema
pin; `contentHash` still covers it. The MCP HTTP bridge's `list_datasets` now
shows each group's own description (and label) instead of the generic text, and
`get_dataset_schema` returns the annotations with each endpoint profile.
`generate:client` emits them as JSDoc on each `ClientApi` entry and output row
field. Upgrade these packages before pointing them at a backend that emits
annotations: earlier validators reject the new member.

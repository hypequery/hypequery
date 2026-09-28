---
"@hypequery/datasets": minor
"@hypequery/serve": patch
"@hypequery/mcp": patch
---

Add an execution `timezone` to dataset and metric queries, with a client default
and UTC as the fallback. Buckets, local time-key filters, windows, and period
comparisons use the selected IANA timezone. Cache entries are separated by
execution timezone, and Serve and MCP accept query overrides.

Remove the metadata-only `timezone` field from semantic definitions. Set it on
`createDatasetClient` or the query instead.

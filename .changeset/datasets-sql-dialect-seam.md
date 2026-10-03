---
"@hypequery/datasets": patch
---

Add an optional datasets SQL rendering hook to query builder factories, with a
ClickHouse default that preserves existing SQL. Resolve the hook from runtime
builder overrides and route existing quoted identifiers through it as the
foundation for subsequent dialect extraction.

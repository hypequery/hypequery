---
"@hypequery/clickhouse": patch
---

`stream()` no longer hangs when an adapter's byte stream splits a JSON row across two chunks, keeps a final row that has no trailing newline, and keeps characters split across chunks intact. The built-in adapter was unaffected because its client hands over whole rows; custom adapters that stream raw bytes were.

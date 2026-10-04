---
"@hypequery/clickhouse": minor
"@hypequery/datasets": minor
"@hypequery/protocol": minor
---

Support composite equality keys in dataset relationships using a non-empty keys array while preserving existing from/to definitions. Compile all pairs as a single-match AND join, preserve tenant scoping and related-measure inputs, and check uniqueness of full non-NULL target tuples. Retain all key pairs in catalogs and portable contract round-trips. Add schema-aware leftAnyJoinOn to the ClickHouse query builder and an optional composite-join capability for custom builders.

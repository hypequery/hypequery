---
"@hypequery/datasets": minor
"@hypequery/protocol": minor
---

Support composite equality keys in dataset relationships using a non-empty keys array while preserving existing from/to definitions. Compile all pairs as a single-match AND join through the key-pair form of `leftAnyJoin` (`@hypequery/clickhouse` >= 2.13.0), preserve tenant scoping and related-measure inputs, and check uniqueness of full non-NULL target tuples. Retain all key pairs in catalogs and portable contract round-trips. Declare `@hypequery/clickhouse` >= 2.13.0 as an optional peer dependency of datasets.

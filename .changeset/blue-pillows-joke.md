---
'@hypequery/clickhouse': major
'@hypequery/cli': patch
---

Release `@hypequery/clickhouse` as `2.0.0` and include the related CLI patch release.

For `@hypequery/clickhouse`, this release includes:

- a refactor toward an explicit query-node internal model
- stricter `withRelation()` behavior for chained relationships
- stricter tuple `IN` validation and improved empty-set filter semantics
- additive `groupBy()` behavior and improved aggregation inference
- support for ClickHouse-native builder features such as `arrayJoin()`, `leftArrayJoin()`, `limitBy()`, and `withTotals()`
- exported built-in time-bucketing helpers such as `toStartOfMinute()` through `toStartOfYear()`
- `url` as the preferred ClickHouse connection field, while keeping deprecated `host` compatibility

For `@hypequery/cli`, this release includes:

- harder non-interactive setup behavior with cleaner failure paths
- NodeNext-safe generated scaffold imports
- improved scaffold dependency installation, including `zod` and aligned canary sibling versions
- support for `--skip-connection` during init scaffolding

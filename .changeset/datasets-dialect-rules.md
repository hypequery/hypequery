---
'@hypequery/datasets': patch
---

Route every ClickHouse-specific SQL spelling in the datasets planner (time grains and arithmetic, timezone conversion, time-measure guards and series expansion, window aggregates, measure-filter literals, formula rendering and row packing) through the internal datasets SQL dialect. Generated ClickHouse SQL is unchanged. A custom `datasetSqlDialect.quoteIdentifier` hook now also applies to time-measure (window and shift) queries.

`GRAIN_FUNCTIONS` is deprecated: grain SQL is engine-specific and no longer read by the planner. Use `SUPPORTED_TIME_GRAINS` to enumerate grains.

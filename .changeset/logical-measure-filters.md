---
'@hypequery/datasets': minor
---

A measure's fixed `filters` accept `{ and }`, `{ or }` and `{ not }` groups of comparisons, like query filters. They publish as RFC 0003 `logical` expressions, compile to one conditional-aggregate condition, and `rehydrateProtocolDatasets` rebuilds them. A release whose measure filter is a `logical` and/or/not, such as one saved by Cloud's model editor, therefore no longer fails to rehydrate, which had broken MCP discovery and execution for it. The rebuilt measure compiles the same SQL as the authored one, and the decision 0005 equality corpus now covers and, or and not filters. `generateDatasetSource` writes the groups back as code. A comparison that isn't field/operator/value is still refused with `HQ_PORTABLE_MEASURE_FILTER_NOT_COMPARISON`. Semantic (non-builder) backends refuse groups, as they do for query filters.

Consumer-breaking: `MeasureOptions['filters']`, `MeasureDefinition['filters']` and `AggregationSpec['filters']` widen from `MetricFilter[]` to `MeasureFilterNode[]` (`DatasetFilterNode<MetricFilter>`, newly exported). Code that reads a measure's filters as comparisons must handle groups, for example with a group check before reading `field`.

---
'@hypequery/protocol': minor
'@hypequery/deployment': minor
'@hypequery/datasets': minor
'@hypequery/protocol-conformance': minor
---

Query-scoped calculations (RFC 0026): an extension 2 dataset query can carry `calculations` — one-off `filter`, `shift`, `window`, `formula` and `compare` variants of published measures — compiled by the same planners as model-level filtered, shift, window and derived measures, so results are exact and permission-checked.

- `@hypequery/protocol`: `validateProtocolSemanticQuery` accepts `calculations`, `limitBy` and `other` under extension 2 (the whole RFC 0026 envelope, including `rank` and `share`), and `having` may name calculation outputs. A calculated query is an invocation 2 record. Result `meta.calculations` types each output column. Cache preimages refuse calculated queries. New `ProtocolQueryCalculation`, `ProtocolFormulaNode`, `ProtocolLimitBy`, `ProtocolOtherBucket`, `ProtocolCalculationColumn` types and `PROTOCOL_CALCULATION_KINDS`.
- `@hypequery/deployment`: the semantic data plane checks every calculation input against the caller's visible measures (a hidden one fails exactly as an unknown one), filter-calculation conditions against the caller's filters, measure kinds, and the `maxMeasures`/`maxFilters` ceilings; `orderBy` may name calculation outputs.
- `@hypequery/datasets`: `DatasetQuery` accepts `calculations` (plus `limitBy` and `other`, refused until implemented). The dataset client and portable executor plan `filter`, `shift`, `window`, `formula` and `compare` against a query-scoped view of the dataset, apply `having`, ordering and paging in an outer stage (so `having` works on time-measure outputs too), report `meta.calculations`, and run such queries uncached. The portable executor reports planning failures as `input-invalid` (new `PortableExecutionInputError`) and kinds it cannot run yet as `unsupported-capability`.
- `@hypequery/protocol-conformance`: new `query-calculations-v1` fixture family, announced by the TypeScript reference adapter.

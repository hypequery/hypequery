---
'@hypequery/protocol': minor
'@hypequery/deployment': minor
'@hypequery/datasets': minor
'@hypequery/protocol-conformance': minor
---

Retention operations (RFC 0027).

- `@hypequery/protocol`: semantic invocation 1 accepts a `retention` operation: `start` and `return` condition lists, `grain` (`day`/`week`/`month`) and `periods` (1–52). New `ProtocolRetentionOperation`, `ProtocolRetentionCondition` and `PROTOCOL_RETENTION_COLUMNS`.
- `@hypequery/deployment`: retention goes through `executeEventOperation` with the same contract checks as funnels. The estimated row count is cohorts × periods × breakdown groups.
- `@hypequery/datasets`: `executeEventOperation` and `prepareEventOperation` run retention as one ClickHouse statement. An entity's cohort is the bucket of its first start event in the range, and it is retained in period p when it has a return event in bucket cohort + p. A period appears only when its whole bucket ends by the range end, so a partly covered period can't understate retention. Results are checked against directly computed cohorts on ClickHouse, including non-UTC zones, a DST change and an exclusive range end.
- `@hypequery/protocol-conformance`: retention cases in `event-operations-v1` and `semantic-invocations-v1`/`v2`.

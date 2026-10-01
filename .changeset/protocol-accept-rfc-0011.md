---
'@hypequery/protocol': minor
'@hypequery/protocol-conformance': minor
---

Accept RFC 0011 (query event 1 and query diagnostics 1), and align the reference validators with the accepted text.

`@hypequery/protocol`:
- `validateProtocolQueryEvent` and `validateProtocolQueryDiagnostics` check `kind` and `version` before the field set. A newer record that adds fields now reports `INVALID_VERSION`, not `UNKNOWN_FIELD`, so a consumer can skip it.
- `occurredAt` must be a real calendar instant with zero or three fractional digits. `2026-02-30`, `24:00`, and `.5` are rejected.
- Free-text fields reject unpaired surrogates. `debugQuery` may contain tab, line feed, and carriage return, because the compiler's debug form spans lines.

`@hypequery/protocol-conformance`:
- `query-events-v1` and `query-diagnostics-v1` gain cases for validation order, versions with added fields, calendar and precision limits, exact byte boundaries, attempts, runtime identity format, and unpaired surrogates.

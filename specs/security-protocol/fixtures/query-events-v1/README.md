# Query event v1 fixtures

- `success.json` contains complete events accepted by the v1 validator.
- `rejections.json` maps generated invalid inputs to stable failure codes.

These fixtures exercise RFC 0011. Rejections include payloads attempting to
carry SQL text (`unknown-sql-field`), parameter values
(`unknown-parameters-field`), and a raw tenant identifier
(`unknown-raw-tenant-field`): the default event has no field that can accept
them, so each fails closed as an unknown field. `newer-version` proves an
older consumer rejects an unknown version cleanly; consumers may skip such
records without failing an event stream.

## Generated rejection semantics

Every rejection is a deterministic transform of this pinned base event
(RFC 0012):

```json
{
  "kind": "hypequery-query-event",
  "version": 1,
  "eventId": "0000000000000000000000000000000000000000000000000000000000000000",
  "occurredAt": "2026-07-20T12:34:56.789Z",
  "target": { "project": "project_1", "environment": "production" },
  "queryName": "daily_revenue",
  "operation": "query",
  "outcome": "success",
  "durationMs": 182
}
```

Generator types expand as follows:

- `wrong-root-type`: an empty array instead of an object;
- `missing-required-field`: the base without `durationMs`;
- `unknown-sql-field`: the base plus `"sql": "SELECT 1"`;
- `unknown-parameters-field`: the base plus
  `"parameters": { "start": "2026-01-01" }`;
- `unknown-raw-tenant-field`: the base plus `"tenantId": "acme"`;
- `newer-version`: the base with `"version": 2`;
- `malformed-event-id`: the base with `"eventId": "bad"`;
- `invalid-occurred-at`: the base with
  `"occurredAt": "2026-13-40T99:99:99Z"`;
- `failure-without-category`: the base with `"outcome": "failure"` and no
  `errorCategory`;
- `success-with-category`: the base plus `"errorCategory": "internal"`
  while `outcome` stays `"success"`;
- `unknown-error-category`: the base with `"outcome": "failure"` plus
  `"errorCategory": "exploded"`;
- `negative-duration`: the base with `"durationMs": -1`;
- `invalid-target`: the base with
  `"target": { "project": "has space", "environment": "production" }`;
- `invalid-query-name`: the base with `"queryName": "not an identifier"`;
- `oversized-correlation-id`: the base plus a `correlationId` of 2049
  repetitions of `x`;
- `unsafe-accessor`: the base with `kind` served by an enumerable computed
  accessor returning `"hypequery-query-event"` instead of a plain data
  property. Host-model conditional (RFC 0012): implementations whose input
  model cannot express computed accessors skip this case.

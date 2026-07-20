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

# Query event v1 fixtures

This RFC 0011 family pins bounded, non-sensitive analytics query events.

- `success.json` contains accepted events.
- `rejections.json` maps invalid or generated events to stable codes.

The default event cannot represent SQL, parameter values, or raw tenant IDs. Coverage also includes versions, event IDs, timestamps, outcomes, error categories, durations, targets, query names, correlation limits, and unsafe accessors.

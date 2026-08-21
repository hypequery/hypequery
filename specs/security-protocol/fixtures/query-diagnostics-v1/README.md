# Query diagnostics v1 fixtures

These fixtures exercise the privileged diagnostics projection in RFC 0011.

- `success.json` contains accepted diagnostic records.
- `rejections.json` maps invalid or generated records to stable failure codes.

Coverage includes required fields, versions, IDs, terminal reasons, attempt counts, safe-message controls, debug-query limits, unknown result or credential fields, and unsafe accessors. Debug queries are deliberately non-executable and contain no parameter values.

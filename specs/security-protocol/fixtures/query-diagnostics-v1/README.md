# Query diagnostics v1 fixtures

- `success.json` contains complete diagnostics projections accepted by the v1
  validator.
- `rejections.json` maps generated invalid inputs to stable failure codes.

These fixtures exercise RFC 0011. The diagnostics projection is privileged
(RFC 0009): it may carry the non-executable RFC 0010 debug form
(`debugQuery`), terminal reason, attempt count, runtime identity, and a safe
message. Rejections prove result rows (`unknown-result-field`) and
credentials (`unknown-credentials-field`) have no representable field, and
that `newer-version` fails closed for older consumers. Note that
`full-diagnostics.debugQuery` uses the deliberately non-executable
placeholder syntax of RFC 0010 and carries no parameter values.

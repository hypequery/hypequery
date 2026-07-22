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

## Generated rejection semantics

Every rejection is a deterministic transform of this pinned base projection
(RFC 0012):

```json
{
  "kind": "hypequery-query-diagnostics",
  "version": 1,
  "eventId": "0000000000000000000000000000000000000000000000000000000000000000",
  "queryId": "1111111111111111111111111111111111111111111111111111111111111111",
  "terminalReason": "completed",
  "attempts": 1
}
```

Generator types expand as follows:

- `wrong-root-type`: an empty array instead of an object;
- `missing-required-field`: the base without `attempts`;
- `unknown-result-field`: the base plus `"rows": [[1, 2]]`;
- `unknown-credentials-field`: the base plus `"password": "hunter2"`;
- `newer-version`: the base with `"version": 2`;
- `malformed-query-id`: the base with `"queryId": "bad"`;
- `unknown-terminal-reason`: the base with `"terminalReason": "exploded"`;
- `zero-attempts`: the base with `"attempts": 0`;
- `control-character-message`: the base plus a `safeMessage` of `bad`,
  U+0007 (BEL), then `message`;
- `oversized-debug-query`: the base plus a `debugQuery` of 4097 repetitions
  of `x`;
- `unsafe-accessor`: the base with `kind` served by an enumerable computed
  accessor returning `"hypequery-query-diagnostics"` instead of a plain
  data property. Host-model conditional (RFC 0012): implementations whose
  input model cannot express computed accessors skip this case.

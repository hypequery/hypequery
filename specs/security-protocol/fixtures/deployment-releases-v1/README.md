# Deployment release envelope v1 fixtures

- `success.json` contains complete envelopes accepted by the v1 validator.
- `rejections.json` maps generated invalid inputs to stable failure codes.
- `identity.json` fixes the RFC 8785 canonical bytes and domain-separated
  SHA-256 identity for matching success fixture ids.

These fixtures exercise RFC 0008. Bundle filesystem verification remains part
of RFC 0007 and is intentionally not duplicated here.

## Generated rejection semantics

Every rejection is a deterministic transform of this pinned base envelope
(RFC 0012):

```json
{
  "kind": "hypequery-deployment-release",
  "version": 1,
  "bundleIdentity": "0000000000000000000000000000000000000000000000000000000000000000",
  "target": { "project": "project_1", "environment": "production" }
}
```

Generator types expand as follows:

- `wrong-root-type`: an empty array instead of an object;
- `unknown-root-field`: the base plus `"extra": true`;
- `unsupported-version`: the base with `"version": 2`;
- `malformed-bundle-identity`: the base with `"bundleIdentity": "bad"`;
- `target-too-large`: the base with `target.project` replaced by `p`
  followed by 128 repetitions of `a` (129 bytes);
- `unsafe-accessor`: the base with `kind` served by an enumerable computed
  accessor returning `"hypequery-deployment-release"` instead of a plain
  data property. Host-model conditional (RFC 0012): implementations whose
  input model cannot express computed accessors skip this case.

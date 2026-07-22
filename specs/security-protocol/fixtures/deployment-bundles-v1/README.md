# Deployment bundle manifest v1 fixtures

- `success.json` contains complete manifests accepted by the v1 validator.
- `rejections.json` maps generated invalid inputs to stable failure codes.
- `identity.json` fixes the RFC 8785 canonical bytes and domain-separated
  SHA-256 identity for matching success fixture ids.

The fixtures exercise RFC 0007. Artifact byte verification is covered by the
CLI reference verifier because these language-neutral fixtures describe the
manifest rather than a filesystem.

## Generated rejection semantics

Every rejection is a deterministic transform of this pinned base manifest
(RFC 0012), where `artifact(index)` denotes (with `<sha256>` the 64-digit
lowercase hexadecimal form of `index`, zero-padded):

```json
{
  "runtime": "node",
  "path": "artifacts/<sha256>.mjs",
  "sha256": "<sha256>",
  "byteLength": 1
}
```

and the base is:

```json
{
  "kind": "hypequery-deployment-bundle",
  "version": 1,
  "deployment": {
    "path": "deployment.json",
    "identity": "1111111111111111111111111111111111111111111111111111111111111111",
    "sha256": "2222222222222222222222222222222222222222222222222222222222222222",
    "byteLength": 1
  },
  "artifacts": [artifact(0)]
}
```

Generator types expand as follows:

- `wrong-root-type`: an empty array instead of an object;
- `unknown-root-field`: the base plus `"extra": true`;
- `unsupported-version`: the base with `"version": 2`;
- `malformed-digest`: the base with `deployment.identity` replaced by
  `"bad"`;
- `traversal-path`: the base with `deployment.path` replaced by
  `"../deployment.json"`;
- `duplicate-path`: the base with its only artifact's `path` replaced by
  `"deployment.json"`, colliding with the deployment path;
- `too-many-artifacts`: the base with 101 artifacts `artifact(0)` through
  `artifact(100)`;
- `deployment-too-large`: the base with `deployment.byteLength` replaced by
  16777217 (16 MiB plus one byte);
- `unsafe-accessor`: the base with `kind` served by an enumerable computed
  accessor returning `"hypequery-deployment-bundle"` instead of a plain
  data property. Host-model conditional (RFC 0012): implementations whose
  input model cannot express computed accessors skip this case.

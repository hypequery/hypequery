# Deployment bundle manifest v1 fixtures

- `success.json` contains complete manifests accepted by the v1 validator.
- `rejections.json` maps generated invalid inputs to stable failure codes.
- `identity.json` fixes the RFC 8785 canonical bytes and domain-separated
  SHA-256 identity for matching success fixture ids.

The fixtures exercise RFC 0007. Artifact byte verification is covered by the
CLI reference verifier because these language-neutral fixtures describe the
manifest rather than a filesystem.

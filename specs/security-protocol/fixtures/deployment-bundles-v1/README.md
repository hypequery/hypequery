# Deployment bundle manifest v1 fixtures

These fixtures pin the closed bundle rules in RFC 0007.

- `success.json` contains accepted manifests.
- `rejections.json` describes invalid manifests and required failure codes.
- `identity.json` pins canonical bytes and domain-separated SHA-256 identities.

Rejections cover root shape, unknown fields, versions, digests, traversal, duplicate paths, artifact and byte limits, and unsafe host-language accessors. Filesystem byte verification is tested by the deployment verifier because this family describes manifests, not directories.

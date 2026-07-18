# Deployment release envelope v1 fixtures

- `success.json` contains complete envelopes accepted by the v1 validator.
- `rejections.json` maps generated invalid inputs to stable failure codes.
- `identity.json` fixes the RFC 8785 canonical bytes and domain-separated
  SHA-256 identity for matching success fixture ids.

These fixtures exercise RFC 0008. Bundle filesystem verification remains part
of RFC 0007 and is intentionally not duplicated here.

# Deployment contract v1 fixtures

- `success.json` contains complete contracts accepted by the v1 validator.
- `rejections.json` maps generated invalid inputs to stable failure codes.
- `identity.json` fixes the RFC 8785 canonical bytes and domain-separated
  SHA-256 identity for matching success fixture ids.

These fixtures exercise RFC 0006 deployment envelopes. `success.json`
contains language-neutral accepted values. `rejections.json` identifies
deterministic generated inputs and the stable error code every conforming
implementation must return.

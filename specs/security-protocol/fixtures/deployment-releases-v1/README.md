# Deployment release v1 fixtures

These fixtures pin RFC 0008 release envelopes, which bind one verified bundle identity to an explicit project and environment.

- `success.json` contains accepted envelopes.
- `rejections.json` maps invalid or generated inputs to stable error codes.
- `identity.json` pins canonical bytes and release identities.

The family covers closed fields, version handling, bundle digests, target limits, and unsafe accessors. Bundle filesystem verification remains in the bundle contract.

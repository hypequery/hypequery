---
'@hypequery/protocol': minor
'@hypequery/protocol-conformance': minor
---

Accept RFC 0009 (capability contract 1 and cache preimage 1), and add the cache preimage and tenant fingerprint to the reference implementation.

`@hypequery/protocol`:
- `buildProtocolCachePreimage` builds the canonical bytes that identify a cached semantic result, to be passed to `deriveProtocolCacheKey`. They cover:
  - the normalized RFC 0003 query;
  - the definition identity;
  - the tenant scope, as fingerprints;
  - the effective row limit.
- `deriveProtocolTenantFingerprint` computes the keyed fingerprint that RFC 0011's `tenantFingerprint` refers to.
- Failures throw `ProtocolCachePreimageError` with a stable `HQ_CACHE_PREIMAGE_*` code.

`@hypequery/protocol-conformance`:
- The bundled fixtures gain the `cache-preimages-v1` family, and the reference adapter announces it.

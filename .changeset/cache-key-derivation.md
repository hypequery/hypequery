---
"@hypequery/protocol": minor
"@hypequery/protocol-conformance": minor
---

Add cache key derivation (RFC 0013, TSP-02).

`@hypequery/protocol` gains `deriveProtocolCacheKey`,
`deriveProtocolCacheNamespaceToken`, `ProtocolCacheKeyError`, and
`PROTOCOL_CACHE_KEY_LIMITS`. Nothing else changes; no existing behaviour is
affected.

The derivation turns a canonical query preimage into an opaque store key with
`HMAC-SHA-256` under a per-project, per-environment secret. It addresses
PYSEC-008: the current semantic cache uses readable canonical JSON as the store
key, so the physical source table, every filter operator and value, and the
resolved tenant predicate and value all appear in `SCAN` output, eviction and
expiry logs, cache-hit metric labels, and admin consoles.

An unkeyed digest would not fix that. The preimage structure is public and the
value space for a tenant identifier or an email is small enough to enumerate
offline, so confidentiality requires a secret rather than a hash.

The scheme separates namespaces two ways: an opaque namespace token forms a
stable prefix for stores that support prefix operations, and the namespace also
participates in the entry MAC directly, so two namespaces cannot collide even
in a store that ignores prefixes. Rotation increments a key version and is a
cache flush by design — entries under a retired secret become unreachable
rather than being served.

`@hypequery/protocol-conformance` gains the `cache-keys-v1` family, and a fix
that reaches further: `compareSuccessOutput` only compared adapter output for
`tagged-values-v1` and `identifiers-v1`. Every other family's success cases
passed on `ok: true` alone, whatever they returned. Cache-key output is now
compared, and a regression test asserts that a mismatched key, a mismatched
namespace token, and empty output each fail.

RFC 0013 is `Proposed`, not accepted. It needs review before PYC-04 implements
it in Python, on the same reasoning as TSP-01: implementing a draft in a second
language freezes it accidentally.

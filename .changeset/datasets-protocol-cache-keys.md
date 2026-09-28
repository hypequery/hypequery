---
'@hypequery/datasets': minor
---

The result cache now stores entries under opaque RFC 0009 / RFC 0013 keys instead of readable query signatures. Tenant ids, filter values, and table names no longer appear in store keys, and keys match the Python SDK's for the same release, query, and tenant.

New optional `cache` options:
- `secret`: the RFC 0013 key secret. When omitted, a random secret is generated per client.
- `project` and `environment`: the key namespace.
- `keyVersion`: increment when rotating the secret.
- `definitionIdentity`: the deployed bundle identity, to share entries across runtimes.

An empty or short secret, or an invalid namespace, now throws when the client is created.

Migration:
- **Default in-memory cache:** no action needed.
- **Shared stores (e.g. Redis):**
  - Existing entries become unreachable after upgrading, so the cache starts cold once and old entries expire by TTL.
  - Set `cache.secret` to the same 32+ random bytes on every instance to share entries across instances. Without it, each client keeps its own entries and logs a one-time warning.
- **Tenant-less datasets queried under a runtime tenant:** entries are now partitioned by that tenant, which is stricter than before.
- **Tools that read or pattern-match store keys:** keys are now opaque `hq1.…` strings. Use `clearCache()` or a store-level flush instead of key patterns.
- `buildDatasetQuerySignature` and `buildMetricQuerySignature` remain exported, but are deprecated and no longer used for keys.

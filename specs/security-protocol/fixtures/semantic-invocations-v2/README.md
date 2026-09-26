# Semantic invocation v2 fixtures

This family accompanies accepted RFC 0015. Semantic invocation 2 is identical to invocation 1 (RFC 0014), except that the `operation` is validated under expression extension 2. It may therefore name segments, `minute`/`hour` grains, and relationship-qualified measures.

Only the invocation request has a version 2. Results and failures remain version 1, and `semantic-invocations-v1` covers them.

The lowest-version rule applies. A version 2 request whose operation uses no extension 2 feature must be sent as version 1, and is rejected with `HQ_INVOCATION_INVALID_VERSION`. An empty `segments` array names no segment, so it does not count as a feature.

Every case was checked against the TypeScript reference implementation. The Python implementation does not announce this family yet.

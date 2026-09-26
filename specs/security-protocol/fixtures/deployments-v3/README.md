# Deployment contract v3 fixtures

This family accompanies accepted RFC 0015. It covers what deployment contract 3 adds to contract 2:

- The dataset filter allow-list is renamed `allowedFilters`, and `filters` is an unknown field.
- Datasets may carry `segments`. Each predicate compares the dataset's own dimensions with literals, never relationship paths, aggregates, arithmetic, or the tenant field.
- The `approxCountDistinct` aggregation, with its required `approximate: true` marker. A derived measure carries the marker exactly when a measure it uses is approximate.
- `window` measures (exactly one of `trailing`, `toDate`, and `cumulative`) and `shift` measures. Each wraps one base measure, needs a dataset `timeField`, and inherits `approximate`. `cumulative` wraps only `sum`, `count`, `min`, or `max`. Derived measures may use them.
- `minute` and `hour` default grains.
- The lowest-version rule. A contract 3 envelope that uses none of these features is rejected with `HQ_DEPLOYMENT_INVALID_VERSION`, because it must be published as contract 2.

`success.json` holds contracts every implementation must accept. `identity.json` pins the canonical bytes and the SHA-256 over the domain `hypequery:deployment:v3\0` for the success case with the same id. `rejections.json` pins a stable code for each rule. As in contract 2, an embedded expression that fails validation reports `HQ_DEPLOYMENT_INVALID_VALUE` at the field that holds it.

The rules that depend on the query grain are consumer checks at query time, not contract rules, so this family does not cover them. These are whole-bucket intervals, `toDate` coarser than the grain, the 1,000-bucket bound, and the required time range.

Every case was generated and checked against the TypeScript reference implementation. The Python implementation does not announce this family yet.

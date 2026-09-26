# Portable expression v2 fixtures

This family accompanies accepted RFC 0015 and covers what expression extension 2 adds to extension 1:

- `minute` and `hour` grains;
- the `approxCountDistinct` aggregation;
- query `segments`;
- one-hop relationship-qualified `measures`.

Every case is validated under extension 2. Extension 2 is a strict superset of extension 1, so every `expressions-v1` success case must also pass under extension 2. The TypeScript reference implementation's unit tests replay them. The extension 1 rejections of the new features remain in `expressions-v1`. For example, `query-invalid-grain` rejects `hour` under extension 1.

Cases use the `expressions-v1` shape: exactly one `value` or `generator`, and rejections select the `expression` or `query` surface.

One generator is added:

- `segments` creates a dataset query `{ "kind": "dataset", "dataset": "orders", "segments": [...] }` with `count` distinct segment names `s0`, `s1`, and so on.

The `segments-validated-before-order-by` case pins RFC 0015's validation order. A duplicate segment reports before an invalid `orderBy` direction. Both report `HQ_EXPRESSION_INVALID_QUERY`, so an implementation passes it either way. The case documents the order rather than distinguishing it.

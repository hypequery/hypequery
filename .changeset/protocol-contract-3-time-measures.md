---
'@hypequery/protocol': minor
'@hypequery/protocol-conformance': minor
---

Deployment contract 3 accepts `window` measures (`trailing`, `toDate`, or `cumulative`) and `shift` measures over a base measure of the same dataset (RFC 0015). They require a dataset `timeField` and inherit `approximate`, and derived measures may use them. `cumulative` is limited to `sum`, `count`, `min` and `max`.

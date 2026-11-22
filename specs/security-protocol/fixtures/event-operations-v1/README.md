# Event operation v1 fixtures

These fixtures exercise the RFC 0027 `funnel` operation as a standalone
record, the way a semantic invocation carries it under `operation`.

- `success.json` contains accepted operations.
- `rejections.json` pins invalid operations and their stable `HQ_EXPRESSION_*`
  codes.

Coverage includes closed records, the 2–10 step bounds, unique identifier step
names, non-empty predicate-only condition lists, the one-encoding window
grammar and its 365-day ceiling, `order` and `by` values, breakdown bounds,
duplicates and reserved output names, `breakdownLimit` requiring a breakdown,
and the pinned timezone registry.

Rules that depend on a deployment contract or a caller, such as whether a
dataset declares `events`, whether a field is filterable and visible, and the
bounded time range, are data-plane checks and are not covered here.

Every case was checked against the TypeScript reference implementation. The
Python implementation does not announce this family yet.

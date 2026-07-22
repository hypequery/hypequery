# Fuzz seed corpus, version 1

Deterministic adversarial seeds replayed verbatim on every conformance run
(RFC 0012). A mutating fuzzer is out of scope; this corpus is the foundation
it would grow. Any input that later crashes an implementation must be
minimized and added here as a seed.

For every seed an implementation must, within the runner timeout, either
accept the input or reject it with a stable code matching
`^HQ_[A-Z0-9_]+$`. It must never crash, hang, or partially execute the
input, and must enforce documented limits before unbounded allocation.

## Files

- `value-sources.json` targets the tagged-values-v1 decode and validation
  path. Entries carry an `id` and exactly one of `sourceUtf8` (exact JSON
  source for a duplicate-aware parser) or `generator` (expanded per the
  tagged-values-v1 README).
- `structured-values.json` targets structural validators. Entries carry an
  `id`, a `value`, and a `targets` array of family names; the seed is
  replayed once per target family through that family's validate operation.
- `sql-expressions.json` targets the sql-portability-v1 compiler. Entries
  carry an `id` and either `sql` (the exact source) or `sqlRepeat`
  (`{ "value": ..., "count": ... }`, expanded by concatenating `count`
  copies of `value`, optionally between `prefix` and `suffix`).

Seed ids are unique within one file. Seeds carry no expected code: any
stable rejection is conforming, and an implementation that accepts a seed
within its limits also conforms.

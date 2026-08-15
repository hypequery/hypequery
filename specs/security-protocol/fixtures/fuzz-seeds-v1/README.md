# Deterministic fuzz seed corpus v1

These adversarial inputs replay on every conformance run under RFC 0012. An implementation may accept a seed within documented limits or reject it with a stable `HQ_*` code; it must never crash, hang, partially execute input, or allocate without bounds.

- `value-sources.json` targets duplicate-aware JSON decoding and tagged values.
- `structured-values.json` targets selected structural validator families.
- `sql-expressions.json` targets the SQL portability compiler.

Minimize any newly discovered crashing input and add it here with a unique ID.

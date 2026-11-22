# query-calculations-v1

Owned by RFC 0026 (query-scoped calculations). Every case is a semantic query
validated under expression extension 2.

- `success.json` `/queries`: accepted queries, one or more per calculation
  kind and mode, plus `limitBy`, `other`, and `having`/`orderBy` on
  calculation outputs. The normalized value equals the input.
- `rejections.json`: `query` mode, each pinning one `HQ_EXPRESSION_*` code for
  a rule RFC 0026 makes decidable from the query alone.

The family is announced by the TypeScript reference adapter. Python adds it to
`conformance:python:protocol`'s `--expect-families` when it implements the
validator. Execution evidence (rows and brute-force results) is in
`drafts/query-calculations-v1/`.

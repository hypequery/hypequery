# Proposed query-calculations-v1 execution rows

Owned by Proposed RFC 0026. Draft execution evidence, not a conformance family:
nothing here is registered in the manifest. The envelope cases live in
`fixtures/query-calculations-v1/`.

`rows.json` is a small tenant-scoped orders table with a NULL country, an
empty month (February 2026), the previous year's rows for `previousYear`, a
user who orders in three countries (so a `countDistinct` share does not sum to
1 and an `Other` bucket cannot be re-aggregated from grouped rows), a tie in
March, and a foreign-tenant row. The live proofs in
`packages/datasets/src/tests/integration/query-calculations*.test.ts` load
these rows and compare every outline item with brute-force SQL over them.

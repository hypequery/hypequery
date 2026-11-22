# Proposed query-calculations-v1 cases

Owned by Proposed RFC 0026. Draft review evidence, not accepted conformance
fixtures: nothing here is registered in the manifest.

- `success.json` (`/queries`) and `rejections.json` (`query` mode) are
  validated under expression extension 2. The implementing pull requests move
  them into `fixtures/query-calculations-v1/`, register the family in the
  manifest, and announce it from the TypeScript reference adapter. Python adds
  the family to its `--expect-families` list when it implements the validator.
- `rows.json` is the execution outline: a small tenant-scoped orders table with
  a NULL country, an empty month (February 2026), the previous year's rows for
  `previousYear`, a user who orders in three countries (so a `countDistinct`
  share does not sum to 1 and an `Other` bucket cannot be re-aggregated from
  grouped rows), a tie in March, and a foreign-tenant row. The implementing
  pull requests pin expected rows for each outline item against brute-force SQL
  over these rows in `packages/datasets/src/tests/integration/`.

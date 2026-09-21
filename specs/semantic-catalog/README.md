# Semantic catalog parity fixture

`catalog.json` is the catalog both `@hypequery/datasets` and `hypequery.datasets`
must produce for the same example semantic model. It is the cross-language
contract for catalog generation: the shape serving, agent tooling, and generated
clients read.

Each implementation defines the model in its own idiom — TypeScript uses
`dataset()` with callback relationships, Python uses `Dataset` with a registry
resolving target names — and both assert deep equality against this file. A
change to either implementation that alters the catalog fails on both sides, so
the two cannot drift silently.

## What the model exercises

The `customers` and `orders` datasets are chosen to cover every catalog rule
that has an edge:

- a SQL-backed dimension (`customers.fullName`), which is excluded from
  relationship fields because it cannot be joined through;
- a `groupable: false` dimension (`customers.tier`), which stays in `fields`
  but is absent from `groupableFields`;
- a `filterable: false` dimension (`orders.status`), and an explicit named
  filter that narrows the operator list;
- `belongsTo`, `hasOne`, and `hasMany` relationships — the last contributing no
  queryable fields at all;
- measures covering a plain aggregate, `countDistinct`, `argMax` with its
  `argField`, `percentile` with its `level`, and a filtered measure whose
  `filterCount` is non-zero;
- a dataset with `tenantKey` and `timeKey` (so `requiresTenant`,
  `supportedGrains`, and the trailing `period` orderable field are populated)
  alongside one with neither;
- `limits`, from which `maxLimit` is derived.

Absent optional values are omitted rather than emitted as null, matching what
`JSON.stringify` does with `undefined`.

## Known gap

`metrics` is empty for both datasets. The Python definition surface has no
metric handles yet, so the model deliberately declares none; the key stays in
the catalog so the shape matches. Extend this fixture with metrics once Python
grows them.

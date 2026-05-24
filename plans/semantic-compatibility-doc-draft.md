# Semantic Compatibility

## Status

Draft implementation notes that will later become product docs.

This document covers the schema ↔ datasets compatibility feature:

- `@hypequery/schema` owns physical schema truth
- `@hypequery/datasets` owns semantic analytics definitions
- compatibility checks answer whether those layers still fit together

## Why This Exists

Schema changes can silently break semantic models.

Examples:

- a dataset source table or materialized view is renamed
- a dimension points at a removed column
- a measure now references a missing field
- a numeric aggregation like `sum()` or `avg()` is left pointing at a string column after a schema change
- a filtered measure references a field that no longer resolves

The compatibility feature gives users a pre-flight safety check before runtime failures.

## User-Facing API

Import the standalone checker:

```ts
import { checkDatasetsAgainstSchema } from '@hypequery/schema';
```

Use it with a schema snapshot and one or more dataset definitions:

```ts
import { serializeSchemaToSnapshot } from '@hypequery/schema';
import { dataset, dimension, measure } from '@hypequery/datasets';

const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.number(),
    status: dimension.string(),
  },
  measures: {
    revenue: measure.sum('amount'),
  },
});

const snapshot = serializeSchemaToSnapshot(mySchema);

const report = checkDatasetsAgainstSchema({
  snapshot,
  datasets: [Orders],
});
```

The checker returns:

```ts
{
  valid: boolean;
  diagnostics: Array<{
    level: 'error' | 'warning';
    code: string;
    datasetName: string;
    fieldName?: string;
    sourceName?: string;
    message: string;
  }>;
}
```

## Supported Checks In V1

- missing dataset source table or materialized view
- missing dimension columns
- missing measure fields
- missing `tenantKey`
- missing `timeKey`
- invalid filtered-measure fields
- `sum` / `avg` on non-numeric ClickHouse columns

Materialized views are supported in a narrow way in v1:

- the checker can validate a dataset source that points at a materialized view
- if the view has a `to` table, compatibility is checked against that target table
- the checker does not yet parse or validate the full materialized view `select`

## Migration Planning Integration

The same compatibility checks can also run as part of migration planning.

```ts
import { createMigrationPlan, diffSnapshots } from '@hypequery/schema';

const plan = createMigrationPlan(diffSnapshots(previousSnapshot, nextSnapshot), {
  semanticCompatibility: {
    datasets: [Orders],
  },
});
```

When enabled, semantic incompatibilities are surfaced in:

- `plan.diagnostics`
- `plan.blockers`

This means schema planning can answer both:

- "is this migration operationally safe?"
- "will this migration break my semantic layer?"

## Example Failure Modes

### Missing measure field

If a migration removes `amount` but a dataset still defines:

```ts
measure.sum('amount')
```

the compatibility checker reports an error and migration planning produces a blocker.

### Invalid numeric aggregation

If a column changes from `Float64` to `String` and a dataset still defines:

```ts
measure.avg('amount')
```

the compatibility checker reports that `avg()` now points at a non-numeric physical column.

## Design Notes

This feature is intentionally additive and decoupled:

- it does not replace existing diff or migration-plan logic
- it does not require `@hypequery/schema` to depend on `@hypequery/datasets` types at compile time
- it accepts a structural dataset contract so real dataset instances can be passed directly

That keeps the package boundary clean:

- `schema` remains the physical layer
- `datasets` remains the semantic layer
- compatibility is the bridge between them

## Current Gaps

Not in v1:

- parsing arbitrary SQL in dimensions or measures
- validating relationship compatibility
- validating raw SQL expressions deeply
- validating materialized view `select` internals
- rename inference or automatic fix suggestions

## Likely Follow-Ups

- integrate compatibility more deeply into migration diagnostics output
- add compatibility checks for relationships
- add compatibility checks for raw SQL fields where practical
- add richer diagnostics grouped by dataset and source
- add docs examples showing CI usage

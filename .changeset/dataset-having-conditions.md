---
"@hypequery/datasets": minor
---

Dataset queries accept `having` conditions on aggregated measure values (HQ-329):

```ts
await analytics.execute(Orders, {
  dimensions: ['customerId'],
  measures: ['revenue'],
  having: [{ measure: 'revenue', operator: 'gt', value: 10_000 }],
});
```

Each condition must reference a selected measure, including derived measures.
Operators are `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `in` and `notIn`.
Values are finite numbers bound as parameters. Conditions are applied after
grouping and before ordering and limits, and are part of the result-cache key.
A dataset's `limits.maxFilters` bounds filters and having conditions together.
Queries that select window or shift measures, and the deprecated semantic backend
path, reject `having`. Generated input schemas accept `having` only when built
with `{ having: true }`, so existing schemas and manifest hashes are unchanged.

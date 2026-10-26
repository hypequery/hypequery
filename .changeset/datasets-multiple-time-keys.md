---
'@hypequery/datasets': minor
'@hypequery/serve': minor
---

Datasets can declare more than one time axis. `timeKey` stays the default; list the others in `timeKeys`, then select one per query with `timeKey`, on dataset and metric queries alike:

```ts
const Orders = dataset('orders', {
  source: 'orders',
  timeKey: 'createdAt',
  timeKeys: ['shippedAt'],
  dimensions: { /* ... */ },
  measures: { revenue: measure.sum('amount') },
});

await client.execute(Orders, { measures: ['revenue'], by: 'month', timeKey: 'shippedAt' });
```

Typed queries narrow `timeKey` to the dataset's declared axes, so a misspelled axis is a compile error (exported as `DatasetTimeKeyNames`). The selected axis drives grains, window and shift measures, and their bounded-range checks. Timezone-free filters on any declared axis use the query timezone. The result cache keys an alternate axis separately; queries on the default axis keep their existing keys. Catalogs and contracts publish `timeKeys` only when a dataset declares alternates. `buildDatasetInputSchema` / `buildMetricInputSchema` take a new opt-in `timeKey` option, which Serve endpoints and `generateDatasetTools` enable, so other schemas and manifest hashes are unchanged. The deprecated `backend` path rejects alternate axes.

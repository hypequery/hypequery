---
"@hypequery/react": patch
---

`useDataset` and `useMetric` responses type `meta` as present when the input sets `includeMeta: true`, and every `useInfiniteDataset` / `useInfiniteMetric` page types `meta` as present, since infinite queries always request it. Responses without `includeMeta` keep `meta` optional.

`useDataset` and `useMetric` options now type `select` against the narrowed response, and the hook's result type follows what `select` returns.

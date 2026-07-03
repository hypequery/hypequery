---
"@hypequery/react": minor
---

`useInfiniteDataset` and `useInfiniteMetric` now project page row types from
the query input, matching `useDataset` / `useMetric`. Selected dimensions and
measures (and `period` for grained queries) are typed on
`data.pages[n].data[m]` instead of requiring casts, unselected fields are
rejected, and infinite-query `options` (e.g. `select`) see the projected page
type.

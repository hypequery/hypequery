---
"@hypequery/serve": minor
"@hypequery/mcp": minor
---

Expose dataset `having` conditions (HQ-329) on every consumption surface:

- Serve dataset endpoints accept and forward `having`. The input schema and
  OpenAPI enumerate each dataset's measures, and the endpoint description
  documents the field.
- MCP `query_dataset` advertises and applies `having`. Local servers and hosted
  discovery gateways list identical schemas (CORE-03), so hosted execution must
  support `having` once it is wired in.
- React `useDataset`, `useInfiniteDataset` and `useQuery('dataset:…')` accept
  `having` through the Serve API types, constrained to the dataset's measures.
  Metric hooks do not accept it.

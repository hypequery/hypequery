---
"@hypequery/mcp": minor
---

Bound the tool manifest itself, not only the queries it describes.

Every existing budget limits one call. None limited what a client is handed
before it makes one — and that is the part that grows with the deployment:
`query_dataset` and `query_metric` carry exact enums of every published dataset,
dimension, measure, and filter field, so the manifest scales with the catalog
while the tool count stays at four. A two-dataset catalog already compiles to
roughly 13.7 KiB, nearly all of it those enums. Every client pays it on every
connection, and a model pays it out of context before a question is asked.

`MCPCatalogBudget` adds two ceilings, configurable on both
`HypequeryMCPExecutor` and `createMCPDiscoveryExecutor`:

- `maxTools` — 64 by default, 256 maximum. The local server publishes a fixed
  four; this is for the hosted tool modes that publish one tool per dataset or
  per verified metric, where the count follows the catalog.
- `maxManifestBytes` — 256 KiB by default, 1 MiB maximum.

A breach raises `MCPCatalogBudgetError`, classified `MCP_CATALOG_TOO_LARGE` in
the `budget` category and not retryable: the same catalog produces the same
manifest every time. A hosted gateway is expected to catch it and choose a
narrower tool mode.

The manifest is refused rather than truncated. A truncated manifest would show
an agent fewer targets than the validators behind it accept, and the manifest
hash would stop identifying the catalog it was compiled from — which is the
property `CORE-03` exists to preserve.

Discovery measures the catalog before `_meta` is attached, so the provenance a
gateway stamps on a manifest is never what pushes it over.

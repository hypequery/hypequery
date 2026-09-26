---
'@hypequery/datasets': patch
'@hypequery/serve': patch
'@hypequery/mcp': patch
---

Expose dataset segments on every query surface. Semantic input schemas, and therefore OpenAPI and the MCP tools, accept `segments` as an enum of the dataset's declared names. Serve dataset and metric endpoints, and the MCP `query_dataset`/`query_metric` tools, forward them to the query. Typed `DatasetQueryFor`/`MetricQueryFor` inputs gain `segments`. Datasets without segments keep their existing schemas.

---
'@hypequery/mcp': patch
---

`get_dataset_schema`'s output schema now declares `segments`, so datasets with segments return `structuredContent` that matches the advertised schema. Every tool's error envelope now lists `MCP_CATALOG_TOO_LARGE` among its codes. The `dataset_guide` prompt now says window and shift measures need `grain` (not `by`) and a bounded time range.

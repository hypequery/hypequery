---
'@hypequery/serve': minor
'@hypequery/mcp': patch
'@hypequery/cli': patch
---

Serve accepts your schemas from Zod 3 or Zod 4. Query inputs and outputs are typed against a structural `ServeSchema` instead of Zod 3's `ZodTypeAny`, so `npm install zod` (which now resolves Zod 4) works with the quick start, and existing Zod 3 projects keep compiling. Query-string coercion and the OpenAPI document read both majors. The optional `zod` peer range is now `^3.23.8 || ^4.0.0`.

Serve and MCP now depend on `zod@^4.6.6` (was `^3.23.8`), clearing GHSA-mrhx-c7xc-m3w5. For dataset and metric endpoints, whose schemas Serve builds, `VALIDATION_ERROR` issue text and codes now follow Zod 4 (for example `Invalid option: expected one of …`, and no `received` field). Endpoints with your own schemas report whatever your Zod reports, as before.

`hypequery init` scaffolds `zod@^4.6.6`.

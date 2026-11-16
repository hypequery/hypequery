---
'@hypequery/mcp': minor
---

`createMCPDiscoveryExecutor` accepts `businessContext`, so a hosted gateway serves a deployment's reviewed business context the way `createMCPExecutor` does: `list_datasets` carries it (in full up to 32 KiB, otherwise the summary and a pointer) and `get_business_context` is listed and returns it. The tools, results and manifest hash are identical to the local executor's for the same catalog and context; an empty document adds nothing. hypequery Cloud uses this to serve the context published in version 2 deployment bundles on the tenant `/mcp` endpoint that `@hypequery/agent` and `hypequery.agent` call.

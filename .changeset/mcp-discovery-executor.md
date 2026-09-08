---
"@hypequery/mcp": minor
---

Add `createMCPDiscoveryExecutor()`, a read-only tool executor that lists a
catalog without being able to execute against it, and `_meta` provenance on the
listed manifest.

A hosted gateway lists tools for one principal against one activated deployment,
before and independently of being able to run anything.
`HypequeryMCPExecutor` cannot serve that: it requires a `DatasetClient` it would
never call, and refuses to construct when a dataset is tenant-scoped and no
fixed `tenantId` is configured. Both are right for a local server, where one
process serves one tenant and every listed tool is runnable; neither holds for a
gateway, which resolves a tenant per request through the deployment data plane.

The discovery executor shares the schema compiler and the catalog tools rather
than introducing a second manifest generator, which is what `CORE-03` exists to
prevent — the schemas an agent is handed and the validators its query is checked
against have to come from one catalog. A test pins that: the tools and manifest
hash it produces are identical to the executor that can run them.

`list_datasets`, `get_dataset_schema`, and the prompts answer normally.
`query_dataset` and `query_metric` are advertised with their exact schemas and
refuse, rather than being hidden: the manifest a client caches should be the one
it keeps seeing once execution is wired in behind it. The refusal is not
`MCP_UNKNOWN_TOOL`, which would invite a client to stop asking for good.

`meta` attaches `activationRevision`, `deploymentIdentity`, and `toolMode` to
`listTools` under the `com.hypequery/` namespace the MCP spec requires of
implementation-defined `_meta`, so a client can cache a manifest and tell when
it went stale. Keys with no value are omitted rather than emitted empty.

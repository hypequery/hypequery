---
"@hypequery/datasets": minor
"@hypequery/serve": minor
---

Add a stable, hashable semantic contract export.

`@hypequery/datasets`:
- Add `serializeSemanticContract`, `contractToStableJson`, `hashContract`, and `SEMANTIC_CONTRACT_VERSION`. The contract is a deterministic, sorted projection of the dataset catalog (dimensions, measures, metrics, filters, relationships, tenant/time policy, limits) with a version marker and SHA-256 content hash, so logically equal models produce identical JSON and hashes. This is the shared source for snapshots, diffs, CI validation, docs, and codegen.
- `serializeSemanticContract` accepts `{ includeSql }` (default `true`) to omit raw SQL escape hatches for untrusted consumers.
- Export the `DatasetCatalogSource` type.

`@hypequery/serve`:
- Expose the contract via a `GET /contract` endpoint (configurable through `semanticPaths.contract`) that serializes the registered datasets with their named metrics grouped onto each dataset. Raw SQL is redacted on this public endpoint by default.

---
"@hypequery/datasets": minor
"@hypequery/serve": patch
---

Accept schema-typed query builders at semantic entry points without casts.

`createQueryBuilder<Schema>` results narrow column parameters to literal
unions, type `execute()` rows concretely, and overload `where`, so they could
not structurally satisfy `QueryBuilderFactoryLike` — passing the documented
`createDatasetClient({ queryBuilder: db })` / `createAPI({ queryBuilder: db })`
pattern failed to compile for typed-schema users.

Public acceptance points (`CreateDatasetClientOptions.queryBuilder`,
`SemanticExecutionRuntime.builderFactory`, serve's `ServeConfig.queryBuilder`)
now take the new `QueryBuilderFactoryInput`, which admits both protocol-shaped
and schema-typed builders. The strict `QueryBuilderFactoryLike` remains the
internal call contract; the exported `toQueryBuilderFactory` adapter converts
between them.

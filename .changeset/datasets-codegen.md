---
"@hypequery/datasets": minor
---

Add `@hypequery/datasets/codegen`: `generateDatasetSource(contract)` turns a deployment contract into idiomatic `dataset()` code, a `datasets.ts` and the `cloud.ts` entrypoint `hypequery deploy` reads. `publishToCloud` over the generated code builds the same contract, with members, and their `examples`, `synonyms` and SQL `dependencies`, in name order (`canonicalMemberOrder`), the only order code produces. Anything `dataset()` code can't express exactly is refused with `ContractExportError` rather than approximated. This is how a model built in hypequery cloud is exported to a repository.

`publishToCloud` gains two optional settings: `endpoints`, a published dataset's exact endpoint policy in place of the one `access` derives (for example a cache TTL, or no row cap), and `supporting`, datasets published without an endpoint beyond those reached through relationships.

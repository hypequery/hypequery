---
"@hypequery/serve": minor
---

Type query resolvers with zod's **output** type instead of its input type.

`SchemaInput<T>` (`T["_input"]`) was used for the resolver, its middlewares, and
the endpoint handler. All three run *after* validation — `pipeline.ts` assigns
`context.input = validationResult.data` before composing middlewares — so they
receive zod's parsed output.

The visible symptom was `.default()`:

```ts
const q = query({
  input: z.object({ limit: z.number().default(10) }),
  query: async ({ input }) => {
    input.limit          // was: number | undefined
    db.limit(input.limit ?? 10)   // default restated, because TS demanded it
  },
});
```

`.transform()`, `.coerce`, `.catch()`, and `.pipe()` were wrong in the same way —
the resolver saw the pre-parse type for all of them.

Caller-facing types are unchanged and still use `SchemaInput`: `InferApiType`,
`InferQueryInput`, `api.execute()`, and `StandaloneQueryDefinition.execute()`.
Over the wire a defaulted field really is optional, so `@hypequery/react` and
anything driving `api.execute()` keep the types they had.

Marked minor rather than patch: resolvers are now typed more precisely, so code
written against the previous (incorrect) type may surface new errors — most
often a now-redundant `?? fallback`, which is safe to delete. Code that already
handled the value correctly keeps compiling.

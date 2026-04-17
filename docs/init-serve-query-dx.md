# Query-First DX with `initServe`

## Goal

Provide a simpler developer experience without losing the strengths of the current `main` API:

- shared context should still be defined once
- queries should be executable outside HTTP
- existing builder-style query definitions should keep working
- `serve()` should remain a thin HTTP wiring layer

## Current State on `main`

Today the primary flow is:

```ts
const { define, query } = initServe({
  context: () => ({ db })
})

const api = define({
  queries: {
    revenue: query
      .input(z.object({ startDate: z.string() }))
      .query(async ({ input, ctx }) => {
        return ctx.db.table("orders").execute()
      })
  }
})
```

This is solid, but it has two DX limitations:

1. The first concept users learn is the builder, not the query itself.
2. Query logic feels bound to the HTTP toolkit even when users want to run it in tests, scripts, jobs, or serverless functions.

## Desired DX

The target shape is a context-bound toolkit returned by `initServe()`:

```ts
const { query, serve } = initServe({
  context: () => ({ db })
})

const revenue = query({
  input: z.object({ startDate: z.string() }),
  query: async ({ input, ctx }) => {
    return ctx.db.table("orders").execute()
  }
})

await revenue.execute({
  input: { startDate: "2024-01-01" }
})

const api = serve({
  queries: { revenue }
})
```

This keeps the existing "pass context once" model while making queries reusable outside HTTP.

## API Design

### 1. `initServe()` remains the shared-runtime entry point

`initServe()` should continue to own:

- shared context
- shared auth configuration
- shared middleware defaults
- shared docs / OpenAPI / basePath configuration

This avoids pushing default context ownership down into each query.

### 2. `query` becomes a hybrid API

The `query` value returned by `initServe()` should support both styles:

```ts
const revenue = query({
  input: z.object({ startDate: z.string() }),
  query: async ({ input, ctx }) => {
    return ctx.db.table("orders").execute()
  }
})
```

and:

```ts
const revenue = query
  .input(z.object({ startDate: z.string() }))
  .query(async ({ input, ctx }) => {
    return ctx.db.table("orders").execute()
  })
```

The builder style remains for advanced composition. The object style becomes the fast path.

### 3. Query objects should be executable

Object-style `query({...})` should return a query definition that can be:

- passed directly to `serve({ queries: { ... } })`
- executed locally with `.execute(...)`
- executed locally with `.run(...)`

Proposed semantics:

- `run({ input, ctx })` is the low-level method that expects a fully formed runtime context
- `execute({ input, context, request })` is the ergonomic method that resolves shared context from `initServe()`

`execute()` should:

1. resolve the default context from `initServe()`
2. merge any explicit `context` override on top
3. construct a minimal runtime context
4. validate `input` when an input schema exists
5. validate the result when an output schema exists

### 4. `serve` becomes the preferred alias for `define`

The initialized toolkit should expose:

- `define(...)` for backward compatibility
- `serve(...)` as the clearer name for new code

Both should use the shared context bound in `initServe()`.

## Non-Goals

- no flattened `serve({ revenue, expenses, ... })` shorthand
- no per-query default context ownership
- no breaking removal of the builder API

The explicit `queries: { revenue }` shape is easier to type, easier to read, and easier to maintain.

## Type Design

The key type additions are:

1. a standalone executable query definition type
2. a callable `QueryFactory` type that intersects with the existing `QueryProcedureBuilder`
3. a `serve` method on `ServeInitializer`

That lets the public API be additive rather than replacing the existing model.

## Migration Story

Existing code should keep working:

```ts
const { define, query } = initServe({ context: () => ({ db }) })

const api = define({
  queries: {
    revenue: query
      .input(z.object({ startDate: z.string() }))
      .query(async ({ input, ctx }) => {
        return ctx.db.table("orders").execute()
      })
  }
})
```

New code can adopt the simpler path:

```ts
const { query, serve } = initServe({ context: () => ({ db }) })

const revenue = query({
  input: z.object({ startDate: z.string() }),
  query: async ({ input, ctx }) => {
    return ctx.db.table("orders").execute()
  }
})

await revenue.execute({
  input: { startDate: "2024-01-01" }
})

const api = serve({
  queries: { revenue }
})
```

## Implementation Plan

1. Add standalone executable query types.
2. Refactor object-style `query()` to return a real serve-compatible query definition.
3. Add `.execute()` and `.run()` behavior with shared-context resolution.
4. Make `initServe().query` a hybrid function + builder.
5. Add `initServe().serve` as an alias of `define`.
6. Add tests for:
   - builder compatibility
   - object-style query execution
   - context resolution from `initServe()`
   - passing object-style queries into `serve()`

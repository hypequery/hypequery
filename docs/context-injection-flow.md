# How `query()` Gets DB Context - Complete Flow

## The Short Answer

**The DB context is injected via the `context` function you pass to `serve()`**

```typescript
const api = serve({
  revenue,  // query object
  context: () => ({ db })  // ← THIS is where DB is provided
})
```

## Detailed Flow

### 1. User Creates API with Context Factory

```typescript
import { query, serve } from '@hypequery/serve'

const revenue = query({
  name: 'revenue',
  query: async ({ input, ctx }) => {
    // ctx will contain { db }
    return ctx.db.table('orders').execute()
  }
})

const api = serve({
  revenue,
  context: () => ({ db })  // Context factory
})
```

### 2. `serve()` Stores Context Factory

When you call `serve()`, it internally calls `defineServe()`:

```typescript
// In /packages/serve/src/serve.ts
export function serve(config) {
  return defineServe({
    ...config,
    queries: convertedQueries
  })
}
```

The `context: () => ({ db })` function is stored in the Serve configuration.

### 3. HTTP Request Arrives

When a request comes in (e.g., `POST /api/analytics/revenue`):

```typescript
POST /api/analytics/revenue
Body: { startDate: "2024-01-01" }
```

### 4. Context Factory is Called

In `/packages/serve/src/pipeline.ts` at line 396:

```typescript
// Resolve context by calling the factory
const resolvedContext = await resolveContext(contextFactory, request, authContext);

// Where resolveContext is:
const resolveContext = async (factory, request, auth) => {
  if (typeof factory === 'function') {
    const value = await factory({ request, auth });  // ← YOUR FUNCTION IS CALLED
    return cloneContext(value);  // Returns { db }
  }
  return cloneContext(factory);
};
```

**Your context function is called:**
```typescript
context: () => ({ db })  // Called as: ({ request, auth }) => ({ db })
```

This returns: `{ db }`

### 5. Context is Merged

At line 397 in pipeline.ts:

```typescript
Object.assign(context, resolvedContext, additionalContext);
```

The `context` object now contains:
```typescript
{
  request: ...,
  input: ...,
  auth: ...,
  db: ...  // ← Your DB from context factory
}
```

### 6. Query is Executed with Context

The query's `run` method is called with the context:

```typescript
// In endpoint.ts
const handler: EndpointHandler = async (ctx) => {
  return runner({
    input: ctx.input,
    ctx: ctx  // ← Context with db is passed here
  });
};
```

Your query receives:
```typescript
{
  input: { startDate: "2024-01-01" },
  ctx: {
    request: ...,
    auth: ...,
    db: ...  // ← Your DB is here!
  }
}
```

### 7. Query Uses DB

```typescript
const revenue = query({
  query: async ({ input, ctx }) => {
    return ctx.db.table('orders').execute()  // ← DB is available!
  }
})
```

## Complete Example with All Steps

```typescript
// Step 1: Import
import { query, serve } from '@hypequery/serve'
import { createQueryBuilder } from '@hypequery/clickhouse'

// Step 2: Create DB connection
const db = createQueryBuilder({
  host: 'localhost',
  database: 'analytics'
})

// Step 3: Define query
const revenue = query({
  name: 'revenue',
  input: z.object({ startDate: z.string() }),
  query: async ({ input, ctx }) => {
    // ctx.db will be injected by serve()
    return ctx.db
      .table('orders')
      .where('date', 'gte', input.startDate)
      .sum('amount', 'total')
      .execute()
  }
})

// Step 4: Create API with context
const api = serve({
  revenue,
  context: () => ({ db })  // ← Provide DB to all queries
})

// Step 5: Register route
api.route('/revenue', api.queries.revenue)

// Step 6: Handle request
// When POST /api/analytics/revenue arrives:
// 1. Context factory is called: context({ request, auth }) → { db }
// 2. Query is executed: query.run({ input, ctx: { ..., db } })
// 3. Query uses ctx.db.table('orders').execute()
```

## Local Execution (No HTTP)

You can also execute queries locally without Serve:

```typescript
const result = await revenue.run({
  input: { startDate: '2024-01-01' },
  ctx: { db }  // ← Provide context manually
})
```

## Context Factory Variations

### Static Context

```typescript
const api = serve({
  revenue,
  context: { db }  // Same DB for all requests
})
```

### Dynamic Context (per-request)

```typescript
const api = serve({
  revenue,
  context: ({ request, auth }) => ({
    db: createQueryBuilder({
      // Different DB per user based on auth
      database: auth.userId
    })
  })
})
```

### Async Context

```typescript
const api = serve({
  revenue,
  context: async ({ request, auth }) => {
    // Fetch DB connection from pool
    const connection = await pool.getConnection()
    return { db: connection }
  }
})
```

### Multi-tenancy

```typescript
const api = serve({
  revenue,
  context: ({ request, auth }) => ({
    db: createQueryBuilder({ ... }),
    tenantId: auth.tenantId  // Available in queries
  }),
  tenant: {
    extract: (auth) => auth.tenantId,
    requireTenant: true
  }
})

// Query can access tenant:
const revenue = query({
  query: async ({ ctx }) => {
    return ctx.db
      .table('orders')
      .where('tenant_id', '=', ctx.tenantId)
      .execute()
  }
})
```

## Key Points

1. **Context is provided to `serve()`, not `query()`**
   - Query defines what it needs
   - Serve provides it via context factory

2. **Context factory is called per-request**
   - Fresh context for each HTTP request
   - Can use request/auth info

3. **Context is injected into query's `ctx` parameter**
   - Available as `ctx.db` (or whatever you named it)
   - Typed correctly via TypeScript

4. **Local execution requires manual context**
   - `query.run({ ctx: { db } })`
   - You provide the context directly

5. **Same pattern works for all context**
   - Database connections
   - Auth tokens
   - Tenant IDs
   - Custom services
   - Any dependencies your queries need

## Why This Pattern?

**Separation of concerns:**
- **Query** = Business logic (what to do)
- **Context** = Dependencies (how to do it)
- **Serve** = Wiring (connect them)

**Testability:**
```typescript
// Test with mock DB
await revenue.run({
  input: { startDate: '2024-01-01' },
  ctx: { db: mockDb }
})

// Production with real DB
const api = serve({
  revenue,
  context: () => ({ db: realDb })
})
```

**Flexibility:**
- Same query can run with different contexts
- Context can vary per request (multi-tenancy)
- Easy to swap implementations (testing, staging, prod)

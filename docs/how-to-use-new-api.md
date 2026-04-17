# How to Use the New Serve API - Quick Start Guide

## Installation

No changes needed! The new API is in the existing `@hypequery/serve` package:

```bash
pnpm install @hypequery/serve
```

---

## Pattern 1: Define and Execute Queries Locally

**Use this when:** You want to run queries without an HTTP API (testing, scripts, serverless functions)

```typescript
import { query } from '@hypequery/serve'
import { createQueryBuilder } from '@hypequery/clickhouse'
import { z } from 'zod'

// 1. Create your database connection
const db = createQueryBuilder({
  host: 'localhost',
  database: 'analytics'
})

// 2. Define a query with default context
const revenue = query({
  name: 'revenue',
  description: 'Monthly revenue calculation',
  // Define context ONCE - called when query is created
  context: () => ({ db }),
  // Define input validation
  input: z.object({
    startDate: z.string(),
    endDate: z.string()
  }),
  // Define the query logic
  query: async ({ input, ctx }) => {
    const result = await ctx.db
      .table('orders')
      .where('date', 'gte', input.startDate)
      .where('date', 'lte', input.endDate)
      .sum('amount', 'total')
      .execute()

    return {
      startDate: input.startDate,
      endDate: input.endDate,
      total: Number(result[0]?.total || 0)
    }
  }
})

// 3. Execute the query (no need to pass context every time!)
const result = await revenue.execute({
  input: {
    startDate: '2024-01-01',
    endDate: '2024-12-31'
  }
})

console.log(`Revenue: $${result.total}`)
```

---

## Pattern 2: Serve Queries as HTTP APIs

**Use this when:** You want to expose queries as HTTP endpoints

```typescript
import { query, serve } from '@hypequery/serve'
import { createQueryBuilder } from '@hypequery/clickhouse'
import { z } from 'zod'

// 1. Create your database connection
const db = createQueryBuilder({
  host: 'localhost',
  database: 'analytics'
})

// 2. Define queries (same as above)
const revenue = query({
  name: 'revenue',
  context: () => ({ db }),
  input: z.object({
    startDate: z.string(),
    endDate: z.string()
  }),
  query: async ({ input, ctx }) => {
    const result = await ctx.db
      .table('orders')
      .where('date', 'gte', input.startDate)
      .where('date', 'lte', input.endDate)
      .sum('amount', 'total')
      .execute()

    return { total: Number(result[0]?.total || 0) }
  }
})

const expenses = query({
  name: 'expenses',
  context: () => ({ db }),
  query: async ({ ctx }) => {
    const result = await ctx.db
      .table('expenses')
      .sum('amount', 'total')
      .execute()

    return { total: Number(result[0]?.total || 0) }
  }
})

// 3. Create API with serve()
const api = serve({
  // Pass your queries (shorthand - no "queries" wrapper needed!)
  revenue,
  expenses,
  // Provide context for Serve
  context: () => ({ db }),
  // Optional: configure basePath
  basePath: '/api/analytics'
})

// 4. Register routes
api.route('/revenue', api.queries.revenue, { method: 'POST' })
api.route('/expenses', api.queries.expenses, { method: 'POST' })

// 5. Create HTTP handler
import { createNodeHandler } from '@hypequery/serve'

const handler = createNodeHandler(api)

// 6. Use with your favorite framework
import express from 'express'

const app = express()
app.use('/api/analytics', handler)

app.listen(3000)
```

Now your queries are available as HTTP APIs:
```bash
# Call revenue API
curl -X POST http://localhost:3000/api/analytics/revenue \
  -H "Content-Type: application/json" \
  -d '{"startDate": "2024-01-01", "endDate": "2024-12-31"}'

# Response:
# { "total": 50000 }
```

---

## Pattern 3: Mix Local Execution and HTTP APIs

**Use this when:** You want both local execution AND HTTP APIs

```typescript
import { query, serve } from '@hypequery/serve'
import { createQueryBuilder } from '@hypequery/clickhouse'

const db = createQueryBuilder({ host: 'localhost', database: 'analytics' })

// Define queries ONCE
const revenue = query({
  name: 'revenue',
  context: () => ({ db }),
  input: z.object({ startDate: z.string() }),
  query: async ({ input, ctx }) => {
    return ctx.db
      .table('orders')
      .where('date', 'gte', input.startDate)
      .sum('amount', 'total')
      .execute()
  }
})

// Use locally in scripts
async function calculateMonthlyRevenue() {
  const result = await revenue.execute({
    input: { startDate: '2024-01-01' }
  })
  console.log(`Revenue: $${result.total}`)
  return result.total
}

// Also expose as HTTP API
const api = serve({
  revenue,
  context: () => ({ db })
})

api.route('/revenue', api.queries.revenue, { method: 'POST' })

// Use in both places!
await calculateMonthlyRevenue()  // Local execution
// AND
// HTTP API at /api/analytics/revenue
```

---

## Pattern 4: Testing with Context Override

**Use this when:** You want to test queries with mock data

```typescript
import { query } from '@hypequery/serve'
import { describe, it, expect } from 'vitest'

// Mock database
const mockDb = {
  table: (tableName: string) => ({
    where: () => ({
      sum: (column: string, alias: string) => ({
        execute: async () => [{ total: 10000 }]
      })
    })
  })
}

// Define query with production context
const revenue = query({
  name: 'revenue',
  context: () => ({ db: realDb }),  // Production DB
  query: async ({ ctx }) => {
    const result = await ctx.db
      .table('orders')
      .sum('amount', 'total')
      .execute()
    return { total: Number(result[0]?.total || 0) }
  }
})

// In tests, override context with mock
describe('Revenue Calculation', () => {
  it('should calculate total revenue', async () => {
    const result = await revenue.execute({
      ctx: { db: mockDb }  // Override with mock DB!
    })

    expect(result.total).toBe(10000)
  })
})
```

---

## Pattern 5: Multiple Queries with Shared Context

**Use this when:** You have many queries that share the same context

```typescript
import { query, serve } from '@hypequery/serve'
import { createQueryBuilder } from '@hypequery/clickhouse'

// 1. Create shared context factory
const createApplicationContext = () => ({
  db: createQueryBuilder({
    host: process.env.DB_HOST,
    database: process.env.DB_NAME
  }),
  cache: createCache()
})

// 2. Define all queries with the same context
const revenue = query({
  name: 'revenue',
  context: createApplicationContext,  // Same context
  query: async ({ ctx }) => ctx.db.table('orders').sum('amount').execute()
})

const expenses = query({
  name: 'expenses',
  context: createApplicationContext,  // Same context
  query: async ({ ctx }) => ctx.db.table('expenses').sum('amount').execute()
})

const users = query({
  name: 'users',
  context: createApplicationContext,  // Same context
  query: async ({ ctx }) => ctx.db.table('users').count('id').execute()
})

// 3. Execute all queries (context handled automatically)
const [revenueResult, expensesResult, usersResult] = await Promise.all([
  revenue.execute({}),
  expenses.execute({}),
  users.execute({})
])

// 4. Or serve them all as APIs
const api = serve({
  revenue,
  expenses,
  users,
  context: createApplicationContext
})
```

---

## Complete Working Example

Here's a complete example you can copy and run:

```typescript
// app.ts
import { query, serve } from '@hypequery/serve'
import { createQueryBuilder } from '@hypequery/clickhouse'
import { z } from 'zod'

// 1. Setup database
const db = createQueryBuilder({
  host: 'localhost',
  database: 'analytics'
})

// 2. Define queries
const monthlyRevenue = query({
  name: 'monthlyRevenue',
  description: 'Calculate total revenue for a date range',
  context: () => ({ db }),
  input: z.object({
    startDate: z.string(),
    endDate: z.string()
  }),
  query: async ({ input, ctx }) => {
    console.log(`Calculating revenue from ${input.startDate} to ${input.endDate}`)

    const result = await ctx.db
      .table('orders')
      .where('date', 'gte', input.startDate)
      .where('date', 'lte', input.endDate)
      .sum('amount', 'total')
      .execute()

    return {
      startDate: input.startDate,
      endDate: input.endDate,
      revenue: Number(result[0]?.total || 0)
    }
  }
})

// 3. Use locally
async function main() {
  console.log('Running query locally...')

  const result = await monthlyRevenue.execute({
    input: {
      startDate: '2024-01-01',
      endDate: '2024-12-31'
    }
  })

  console.log(`Revenue: $${result.revenue}`)
  return result
}

// 4. Or create HTTP API
const api = serve({
  monthlyRevenue,
  context: () => ({ db }),
  basePath: '/api/analytics'
})

api.route('/revenue', api.queries.monthlyRevenue, { method: 'POST' })

// 5. Run main or start server
if (import.meta.url === `file://${process.argv[1]}`) {
  // Running as script
  main().catch(console.error)
} else {
  // Being imported - export API
  export { api }
}
```

---

## Comparison: Old vs New API

### Old API (Still Works!)

```typescript
import { initServe } from '@hypequery/serve'

const { define, query } = initServe({
  context: () => ({ db })
})

const api = define({
  queries: {
    revenue: query
      .input(z.object({ start: z.string() }))
      .query(async ({ input, ctx }) => {
        return ctx.db.table('orders').execute()
      })
  }
})

api.route('/revenue', api.queries.revenue)
```

### New API (Recommended)

```typescript
import { query, serve } from '@hypequery/serve'

const revenue = query({
  context: () => ({ db }),
  input: z.object({ start: z.string() }),
  query: async ({ input, ctx }) => {
    return ctx.db.table('orders').execute()
  }
})

// Execute locally
await revenue.execute({ input: { start: '2024-01-01' } })

// Or serve as API
const api = serve({ revenue, context: () => ({ db }) })
api.route('/revenue', api.queries.revenue)
```

---

## Quick Reference

### Import
```typescript
import { query, serve } from '@hypequery/serve'
```

### Define Query
```typescript
const myQuery = query({
  name: 'myQuery',              // Optional: for docs
  context: () => ({ db }),       // Optional: default context
  input: z.object({ ... }),      // Optional: input validation
  output: z.object({ ... }),     // Optional: output validation
  query: async ({ input, ctx }) => {
    return ctx.db.table(...).execute()
  }
})
```

### Execute Locally
```typescript
// With default context
await myQuery.execute({})

// With input
await myQuery.execute({ input: { value: 123 } })

// Override context (for testing)
await myQuery.execute({ ctx: { db: mockDb } })
```

### Serve as API
```typescript
const api = serve({
  myQuery,
  context: () => ({ db })
})

api.route('/myQuery', api.queries.myQuery)
```

---

## Next Steps

1. ✅ Try the new API in a small project
2. ✅ Use `query()` with `context` for local execution
3. ✅ Add `serve()` when you need HTTP APIs
4. ✅ Keep using the old API if you prefer (it still works!)

The new API gives you **flexibility** - use what works best for your use case!

# Standalone Query Execution - No Serve Required! 🎉

## The Key Insight

**You can now use `query()` without Serve!**

The query objects created by `query()` have an `.execute()` method that works **completely independently** of Serve.

## Two Ways to Use Queries

### 1. Local Execution (No Serve)

```typescript
import { query } from '@hypequery/serve'
import { z } from 'zod'

// Define a query
const revenue = query({
  name: 'revenue',
  input: z.object({ startDate: z.string() }),
  query: async ({ input, ctx }) => {
    return ctx.db.table('orders')
      .where('date', 'gte', input.startDate)
      .sum('amount', 'total')
      .execute()
  }
})

// Execute locally WITHOUT Serve
const result = await revenue.execute({
  input: { startDate: '2024-01-01' },
  ctx: { db }  // You provide the context directly
})

console.log(result.total)  // Works!
```

### 2. Serve as HTTP API (Optional)

```typescript
import { serve } from '@hypequery/serve'

// When you're ready to expose as an API
const api = serve({
  revenue,  // Same query object!
  context: () => ({ db })  // Serve provides context
})

// Automatic routes:
// POST /api/analytics/revenue
```

## The Mental Model

### Incremental Adoption Path

**Step 1: Define queries**
```typescript
const revenue = query({ ... })
const expenses = query({ ... })
```

**Step 2: Run locally**
```typescript
await revenue.execute({ ctx: { db } })
await expenses.execute({ ctx: { db } })
```

**Step 3: (Optional) Serve as APIs**
```typescript
serve({ revenue, expenses, context: () => ({ db }) })
```

## Key Differences

### `.execute()` Method (Local)

- **You provide context**: `execute({ ctx: { db } })`
- **No HTTP layer**: Direct execution
- **Great for**: Testing, scripts, batch jobs, serverless functions
- **Works anywhere**: No Serve required

### `.run()` Method (Serve Internal)

- **Serve provides context**: Via `context: () => ({ db })`
- **HTTP layer**: Full request/response cycle
- **Great for**: APIs, webhooks, authenticated endpoints
- **Requires Serve**: Only works within Serve

## Real-World Examples

### Example 1: Serverless Function

```typescript
import { query } from '@hypequery/serve'

const getRevenue = query({
  name: 'getRevenue',
  input: z.object({ userId: z.string() }),
  query: async ({ input, ctx }) => {
    return ctx.db.table('orders')
      .where('user_id', '=', input.userId)
      .sum('amount', 'total')
      .execute()
  }
})

// AWS Lambda handler
export const handler = async (event) => {
  const userId = event.requestContext.authorizer.userId

  const result = await getRevenue.execute({
    input: { userId },
    ctx: { db: await getDbConnection() }
  })

  return {
    statusCode: 200,
    body: JSON.stringify(result)
  }
}
```

### Example 2: Cron Job / Batch Processing

```typescript
import { query } from '@hypequery/serve'

const dailyRevenue = query({
  name: 'dailyRevenue',
  query: async ({ ctx }) => {
    return ctx.db.table('orders')
      .where('date', '=', new Date().toISOString().split('T')[0])
      .sum('amount', 'total')
      .execute()
  }
})

// Run daily at midnight
cron.schedule('0 0 * * *', async () => {
  const result = await dailyRevenue.execute({
    ctx: { db: await getDbConnection() }
  })

  console.log(`Daily revenue: $${result.total}`)

  // Send to Slack, store in database, etc.
  await sendToSlack(result.total)
})
```

### Example 3: Testing

```typescript
import { query } from '@hypequery/serve'
import { describe, it, expect } from 'vitest'

const calculateRevenue = query({
  name: 'calculateRevenue',
  input: z.object({ startDate: z.string() }),
  query: async ({ input, ctx }) => {
    return ctx.db.table('orders')
      .where('date', 'gte', input.startDate)
      .sum('amount', 'total')
      .execute()
  }
})

describe('Revenue Calculation', () => {
  it('should calculate total revenue', async () => {
    const result = await calculateRevenue.execute({
      input: { startDate: '2024-01-01' },
      ctx: { db: mockDb }  // Mock database!
    })

    expect(result.total).toBe(10000)
  })
})
```

### Example 4: Gradual Migration to Serve

```typescript
// Start with local execution
const revenue = query({
  name: 'revenue',
  query: async ({ ctx }) => ctx.db.table('orders').sum('amount', 'total').execute()
})

// Use locally in scripts
await revenue.execute({ ctx: { db } })

// Later, add Serve when you need an API
const api = serve({
  revenue,
  context: () => ({ db })
})

// Now you have both!
await revenue.execute({ ctx: { db } })  // Still works
// AND
await fetch('http://localhost:3000/api/analytics/revenue')  // New HTTP API
```

## Why This Matters

### Before Your Observation

You were right - the original implementation required Serve for context injection:

```typescript
// ❌ This didn't work
const revenue = query({ ... })
await revenue.run({ ctx: { db } })  // Error: run() expects full QueryRuntimeContext
```

### After Your Observation

Now with `.execute()` method:

```typescript
// ✅ This works!
const revenue = query({ ... })
await revenue.execute({ ctx: { db } })  // Perfect!
```

### Key Benefits

1. **True Incremental Adoption**
   - Start with queries
   - Run them locally
   - Add Serve only when needed

2. **Testability**
   - Execute queries in tests without HTTP layer
   - Mock context easily
   - No Serve setup required

3. **Flexibility**
   - Use in serverless functions
   - Use in cron jobs
   - Use in scripts
   - Use in Serve (when ready)

4. **No Vendor Lock-in**
   - Queries are independent
   - Can use with or without Serve
   - Migrate at your own pace

## Summary

**Your observation was 100% correct!**

Now:
- ✅ **`.execute()`** - Local execution, you provide context
- ✅ **`serve()`** - HTTP API, Serve provides context
- ✅ **Incremental adoption** - Start small, add Serve later
- ✅ **No forced migration** - Use queries anywhere

**This is the true incremental approach you wanted!** 🎯

# Context Management - Final Solution 🎯

## Your Insight Was Spot-On

You identified that requiring Serve for context injection **defeated the purpose** of the incremental approach.

**Problem:**
```typescript
// ❌ Had to pass context every time
await revenue.execute({ ctx: { db } })
await expenses.execute({ ctx: { db } })
await users.execute({ ctx: { db } })
```

**Solution:**
```typescript
// ✅ Define context once, use everywhere
const revenue = query({
  context: () => ({ db }),  // Define once
  query: async ({ ctx }) => ctx.db.table('orders').execute()
})

// Execute without passing context every time
await revenue.execute({ input: { start: '2024-01-01' } })
await expenses.execute({ input: { ... } })
await users.execute({ input: { ... } })
```

## Three Context Patterns

### Pattern 1: Default Context (Recommended for Most Cases)

```typescript
import { query } from '@hypequery/serve'
import { createQueryBuilder } from '@hypequery/clickhouse'

// Create DB connection once
const db = createQueryBuilder({ ... })

// Define query with default context
const revenue = query({
  name: 'revenue',
  context: () => ({ db }),  // Called once when query is created
  input: z.object({ startDate: z.string() }),
  query: async ({ input, ctx }) => {
    return ctx.db.table('orders')
      .where('date', 'gte', input.startDate)
      .sum('amount', 'total')
      .execute()
  }
})

// Execute without passing context every time!
await revenue.execute({ input: { startDate: '2024-01-01' } })
await revenue.execute({ input: { startDate: '2024-02-01' } })
await revenue.execute({ input: { startDate: '2024-03-01' } })
```

**Benefits:**
- ✅ Define context once
- ✅ No repetitive context passing
- ✅ Simple and clean
- ✅ Perfect for single-database apps

### Pattern 2: Override Context (For Testing/Flexibility)

```typescript
const revenue = query({
  context: () => ({ db }),  // Default context
  query: async ({ ctx }) => ctx.db.table('orders').execute()
})

// Use default context normally
await revenue.execute({})

// Override for testing
await revenue.execute({
  ctx: { db: mockDb }
})

// Override for different database
await revenue.execute({
  ctx: { db: analyticsDb }
})
```

**Benefits:**
- ✅ Best of both worlds
- ✅ Default context for normal use
- ✅ Override when needed (testing, multi-DB)
- ✅ Maximum flexibility

### Pattern 3: Per-Execution Context (For Advanced Cases)

```typescript
const revenue = query({
  // No default context
  query: async ({ input, ctx }) => ctx.db.table('orders').execute()
})

// Pass context manually each time
await revenue.execute({
  input: { startDate: '2024-01-01' },
  ctx: { db: userSpecificDb }  // Different DB per execution
})
```

**Benefits:**
- ✅ Full control
- ✅ Different context per execution
- ✅ Great for multi-tenant scenarios
- ✅ Maximum flexibility

## Comparison: Old vs New

### Old Model (Serve Only)

```typescript
// ❌ Context tied to Serve
const api = serve({
  revenue,
  context: () => ({ db })
})

// Can't execute queries without Serve
```

### New Model (Flexible Context)

```typescript
// ✅ Query owns its context
const revenue = query({
  context: () => ({ db }),
  query: async ({ ctx }) => ctx.db.table('orders').execute()
})

// Can execute independently!
await revenue.execute({})

// Or serve as API
const api = serve({
  revenue,  // Same query!
  context: () => ({ db })  // Serve provides its own context
})
```

## Real-World Examples

### Example 1: Single Database App

```typescript
// lib/db.ts
import { createQueryBuilder } from '@hypequery/clickhouse'

export const db = createQueryBuilder({
  host: process.env.DB_HOST,
  database: 'analytics'
})

// lib/queries/revenue.ts
import { query } from '@hypequery/serve'
import { db } from '../db.js'

export const revenue = query({
  name: 'revenue',
  context: () => ({ db }),  // Use shared DB
  query: async ({ input, ctx }) => {
    return ctx.db.table('orders').sum('amount', 'total').execute()
  }
})

// scripts/calculate-revenue.ts
import { revenue } from './lib/queries/revenue.js'

async function main() {
  const result = await revenue.execute({
    input: { startDate: '2024-01-01' }
  })
  console.log(`Revenue: $${result.total}`)
}

// api/index.ts
import { serve } from '@hypequery/serve'
import { revenue } from './lib/queries/revenue.js'

const api = serve({
  revenue,
  context: () => ({ db })  // Same DB
})

api.route('/revenue', api.queries.revenue)
```

### Example 2: Testing with Mock Context

```typescript
// queries/user-stats.ts
import { query } from '@hypequery/serve'
import { db } from './db.js'

export const userStats = query({
  name: 'userStats',
  context: () => ({ db }),
  input: z.object({ userId: z.string() }),
  query: async ({ input, ctx }) => {
    return ctx.db
      .table('users')
      .where('id', '=', input.userId)
      .select(['name', 'email'])
      .execute()
  }
})

// tests/user-stats.test.ts
import { userStats } from './queries/user-stats.js'
import { describe, it, expect } from 'vitest'

describe('User Stats', () => {
  it('should return user stats', async () => {
    const result = await userStats.execute({
      input: { userId: '123' },
      ctx: { db: mockDb }  // Override with mock DB!
    })

    expect(result).toEqual({ name: 'John', email: 'john@example.com' })
  })
})
```

### Example 3: Multi-Tenant Application

```typescript
// queries/tenant-data.ts
import { query } from '@hypequery/serve'

export const tenantData = query({
  name: 'tenantData',
  // No default context - will be provided per-execution
  query: async ({ input, ctx }) => {
    return ctx.db
      .table('data')
      .where('tenant_id', '=', ctx.tenantId)
      .execute()
  }
})

// Middleware that provides tenant-specific context
function withTenant(tenantId: string) {
  const db = getTenantDb(tenantId)
  return { db, tenantId }
}

// Usage in serverless function
export const handler = async (event, context) => {
  const tenantId = event.requestContext.authorizer.tenantId

  const result = await tenantData.execute({
    ctx: withTenant(tenantId)
  })

  return { statusCode: 200, body: JSON.stringify(result) }
}
```

## Context Priority Order

When you call `.execute()`, context is resolved in this order:

1. **Explicit context** (if provided): `execute({ ctx: { customDb } })`
2. **Default context** (if defined): `context: () => ({ db })`
3. **Empty object** (fallback): `{}`

```typescript
const query = query({
  context: () => ({ db: defaultDb }),
  query: async ({ ctx }) => ctx.db.execute()
})

// 1. Explicit context wins
await query.execute({ ctx: { db: customDb } })  // Uses customDb

// 2. Default context used
await query.execute({})  // Uses defaultDb

// 3. Empty object fallback
await query.execute({ ctx: undefined })  // Uses {}
```

## Key Insight

**Your question led to the right answer:**

> "In the old model we passed context once in defineServe, shall we keep this? Rather than passing on every execution?"

**Yes!** And now we have **both options**:

1. **Define once, use everywhere** (like old Serve model)
2. **Override when needed** (for testing, flexibility)

This gives you:
- ✅ Simplicity of default context
- ✅ Flexibility of per-execution context
- ✅ Best of both worlds
- ✅ True incremental adoption

## Summary

**Before (your observation):**
```typescript
// ❌ Repetitive
await q1.execute({ ctx: { db } })
await q2.execute({ ctx: { db } })
await q3.execute({ ctx: { db } })
```

**After (your suggestion):**
```typescript
// ✅ Define once
const q1 = query({ context: () => ({ db }), ... })
const q2 = query({ context: () => ({ db }), ... })
const q3 = query({ context: () => ({ db }), ... })

// ✅ Use without repetition
await q1.execute({ input: {...} })
await q2.execute({ input: {...} })
await q3.execute({ input: {...} })
```

**You were absolutely right!** This is the pattern that matches the old Serve model while enabling true incremental adoption. 🎯

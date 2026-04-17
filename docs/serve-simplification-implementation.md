# Serve API Simplification - Implementation Plan

## Goal

Simplify the Serve API from:
```typescript
const { define, query } = initServe(...)
define({
  queries: {
    revenue: query(...)
  }
})
```

To:
```typescript
const revenue = query(...)
serve({ revenue })
```

**With zero breaking changes.**

---

## Implementation

### Step 1: Create standalone `query()` helper

**File:** `/packages/serve/src/query.ts` (NEW)

```typescript
import type { ZodTypeAny } from 'zod';
import type {
  AuthContext,
  QueryResolver,
  QueryResolverArgs,
  ExecutableQuery,
} from './types.js';

/**
 * Define a standalone query object
 *
 * @example
 * const revenue = query({
 *   name: 'revenue',
 *   input: z.object({ start: z.string() }),
 *   query: async ({ input, ctx }) => {
 *     return ctx.db.table('orders').execute()
 *   }
 * })
 */
export function query<
  TInput = unknown,
  TResult = unknown,
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
>(config: {
  name?: string;
  input?: ZodTypeAny;
  output?: ZodTypeAny;
  description?: string;
  summary?: string;
  tags?: string[];
  query: QueryResolver<TInput, TResult, TContext, TAuth>;
}): ExecutableQuery<TInput, TResult, TContext, TAuth> & {
  __serveQuery?: true;
  metadata?: {
    name?: string;
    description?: string;
    summary?: string;
    tags?: string[];
  };
} {
  const queryObj = {
    run: config.query,
    __serveQuery: true,
    metadata: {
      name: config.name,
      description: config.description,
      summary: config.summary,
      tags: config.tags,
    },
  };

  // Support both function and object with .run()
  return queryObj as ExecutableQuery<TInput, TResult, TContext, TAuth> & {
    __serveQuery?: true;
    metadata?: {
      name?: string;
      description?: string;
      summary?: string;
      tags?: string[];
    };
  };
}
```

### Step 2: Create `serve()` function

**File:** `/packages/serve/src/serve.ts` (NEW)

```typescript
import type {
  AuthContext,
  ServeConfig,
  ServeContextFactory,
  ServeBuilder,
  ServeQueriesMap,
  ServeEndpointMap,
} from './types.js';
import { defineServe } from './server/define-serve.js';
import { isServeQuery } from './utils/query-utils.js';

/**
 * Simplified serve API
 *
 * @example
 * const revenue = query({ ... })
 * serve({
 *   revenue,
 *   context: () => ({ db })
 * })
 */
export function serve<
  TContext extends Record<string, unknown> = Record<string, unknown>,
  TAuth extends AuthContext = AuthContext
>(
  config: Omit<ServeConfig<TContext, TAuth, any>, 'queries'> & {
    queries?: Record<string, unknown>;
    [key: string]: unknown;
  }
): ServeBuilder<any, TContext, TAuth> {
  // Extract queries from config
  const queriesConfig = config.queries ?? {};
  const otherConfig = { ...config };
  delete otherConfig.queries;

  // Convert query objects to ServeQueriesMap format
  const queries: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(queriesConfig)) {
    if (isServeQuery(value)) {
      // It's already a query object, wrap it
      queries[key] = value;
    } else if (typeof value === 'object' && value !== null) {
      // Assume it's a query config
      queries[key] = value;
    }
  }

  // Also check top-level keys (shorthand support)
  for (const [key, value] of Object.entries(otherConfig)) {
    if (isServeQuery(value)) {
      queries[key] = value;
      delete (otherConfig as Record<string, unknown>)[key];
    }
  }

  return defineServe({
    ...otherConfig,
    queries: queries as any,
  } as ServeConfig<TContext, TAuth, any>);
}
```

### Step 3: Add utility to detect query objects

**File:** `/packages/serve/src/utils/query-utils.ts` (NEW)

```typescript
import type { ExecutableQuery } from '../types.js';

/**
 * Check if an object is a serve query object
 */
export function isServeQuery(obj: unknown): obj is ExecutableQuery & {
  __serveQuery?: true;
} {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const query = obj as Record<string, unknown>;

  // Check for marker
  if (query.__serveQuery === true) {
    return true;
  }

  // Check for run function
  if (typeof query.run === 'function') {
    return true;
  }

  return false;
}
```

### Step 4: Export new APIs

**File:** `/packages/serve/src/index.ts`

```typescript
// Existing exports
export * from "./types.js";
export * from "./query-logger.js";
export * from "./server/index.js";
export * from "./router.js";
export * from "./endpoint.js";
export * from "./openapi.js";
export * from "./docs-ui.js";
export * from "./auth.js";
export * from "./cors.js";
export * from "./errors.js";
export * from "./rate-limit.js";
export * from "./client-config.js";
export * from "./utils.js";
export * from "./adapters/node.js";
export * from "./adapters/fetch.js";
export * from "./adapters/vercel.js";
export * from "./dev.js";

// NEW: Top-level exports
export { query } from './query.js';
export { serve } from './serve.js';
```

### Step 5: Support query objects in defineServe

**File:** `/packages/serve/src/server/define-serve.ts`

Add helper to convert query objects to endpoints:

```typescript
import { isServeQuery } from '../utils/query-utils.js';

// In the defineServe function, add this helper:

function convertQueryToEndpoint(
  key: string,
  queryObj: unknown
): ServeEndpoint | null {
  if (!isServeQuery(queryObj)) {
    return null;
  }

  // Create endpoint from query object
  return createEndpoint({
    key,
    method: 'POST', // Default method
    query: queryObj,
    inputSchema: (queryObj as any).inputSchema,
    outputSchema: (queryObj as any).outputSchema,
    metadata: {
      name: (queryObj as any).metadata?.name || key,
      description: (queryObj as any).metadata?.description,
    },
  });
}
```

Then update the queries processing:

```typescript
// Existing code around line 79
const configuredQueries = config.queries ?? ({} as TQueries);
const queryEntries = {} as ServeEndpointMap<TQueries, TContext, TAuth>;

for (const [key, queryConfig] of Object.entries(configuredQueries)) {
  // Check if it's a query object
  if (isServeQuery(queryConfig)) {
    const endpoint = convertQueryToEndpoint(key, queryConfig);
    if (endpoint) {
      queryEntries[key as keyof TQueries] = endpoint as any;
    }
    continue;
  }

  // Existing ServeQueryConfig handling
  // ... (keep existing code)
}
```

---

## Migration Examples

### Example 1: Before (current API)

```typescript
import { initServe } from '@hypequery/serve'
import { z } from 'zod'

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

### Example 2: After (new API)

```typescript
import { query, serve } from '@hypequery/serve'
import { z } from 'zod'

const revenue = query({
  name: 'revenue',
  input: z.object({ start: z.string() }),
  query: async ({ input, ctx }) => {
    return ctx.db.table('orders').execute()
  }
})

const api = serve({
  revenue,
  context: () => ({ db })
})
```

### Example 3: Mixed (both work)

```typescript
import { query, serve, initServe } from '@hypequery/serve'
import { z } from 'zod'

// New way
const revenue = query({
  name: 'revenue',
  query: async ({ ctx }) => ctx.db.table('orders').execute()
})

// Old way still works
const { define, query: queryBuilder } = initServe({
  context: () => ({ db })
})

const oldApi = define({
  queries: {
    expenses: queryBuilder.query(async ({ ctx }) => {
      return ctx.db.table('expenses').execute()
    })
  }
})

// New way
const newApi = serve({
  revenue,
  context: () => ({ db })
})
```

---

## Testing Strategy

### Unit Tests

**File:** `/packages/serve/src/test/query.test.ts` (NEW)

```typescript
import { describe, it, expect } from 'vitest'
import { query } from '../query.js'
import { z } from 'zod'

describe('query()', () => {
  it('should create a query object', () => {
    const revenue = query({
      name: 'revenue',
      query: async ({ ctx }) => ({ total: 100 })
    })

    expect(revenue).toBeDefined()
    expect(typeof revenue.run).toBe('function')
    expect(revenue.__serveQuery).toBe(true)
  })

  it('should support input schema', () => {
    const revenue = query({
      input: z.object({ start: z.string() }),
      query: async ({ input }) => ({ total: 100 })
    })

    expect(revenue).toBeDefined()
  })

  it('should support metadata', () => {
    const revenue = query({
      name: 'revenue',
      description: 'Monthly revenue',
      tags: ['analytics'],
      query: async () => ({ total: 100 })
    })

    expect(revenue.metadata?.name).toBe('revenue')
    expect(revenue.metadata?.description).toBe('Monthly revenue')
    expect(revenue.metadata?.tags).toEqual(['analytics'])
  })
})
```

### Integration Tests

**File:** `/packages/serve/src/test/serve.test.ts` (NEW)

```typescript
import { describe, it, expect } from 'vitest'
import { query, serve } from '../serve.js'
import { z } from 'zod'

describe('serve()', () => {
  it('should accept query objects', () => {
    const revenue = query({
      name: 'revenue',
      query: async () => ({ total: 100 })
    })

    const api = serve({
      revenue,
      context: () => ({})
    })

    expect(api).toBeDefined()
  })

  it('should accept queries wrapper', () => {
    const revenue = query({
      name: 'revenue',
      query: async () => ({ total: 100 })
    })

    const api = serve({
      queries: { revenue },
      context: () => ({})
    })

    expect(api).toBeDefined()
  })

  it('should work with multiple queries', () => {
    const revenue = query({
      name: 'revenue',
      query: async () => ({ total: 100 })
    })

    const expenses = query({
      name: 'expenses',
      query: async () => ({ total: 50 })
    })

    const api = serve({
      revenue,
      expenses,
      context: () => ({})
    })

    expect(api).toBeDefined()
  })
})
```

---

## Documentation Updates

### Getting Started Guide

**File:** `/website/docs/getting-started.md`

```markdown
# Getting Started

## Define Your First Query

```typescript
import { query } from '@hypequery/serve'
import { z } from 'zod'

const revenue = query({
  name: 'revenue',
  description: 'Monthly revenue',
  input: z.object({
    startDate: z.string(),
    endDate: z.string()
  }),
  query: async ({ input, ctx }) => {
    return ctx.db.table('orders')
      .where('date', 'gte', input.startDate)
      .where('date', 'lte', input.endDate)
      .sum('amount', 'total')
      .execute()
  }
})
```

## Serve as API

```typescript
import { serve } from '@hypequery/serve'

const api = serve({
  revenue,
  context: () => ({ db })
})

// Automatic routes:
// POST /api/analytics/revenue
```

## Run Locally

```typescript
const result = await revenue.run({
  input: { startDate: '2024-01-01', endDate: '2024-12-31' },
  ctx: { db }
})
```
```

### Migration Guide

**File:** `/website/docs/migrate-serve-api.md`

```markdown
# Migrating to the New API

## What's Changed?

The new API separates query definition from serving:

**Before:**
```typescript
const { define, query } = initServe({ context: () => ({ db }) })

const api = define({
  queries: {
    revenue: query(...).query(...)
  }
})
```

**After:**
```typescript
const revenue = query({ ... })

const api = serve({ revenue, context: () => ({ db }) })
```

## Migration Steps

### Step 1: Extract query definitions

**Before:**
```typescript
const { define, query } = initServe({ context: () => ({ db }) })

const api = define({
  queries: {
    revenue: query
      .input(z.object({ start: z.string() }))
      .query(async ({ input, ctx }) => {
        return ctx.db.table('orders').execute()
      })
  }
})
```

**After:**
```typescript
import { query } from '@hypequery/serve'

const revenue = query({
  name: 'revenue',
  input: z.object({ start: z.string() }),
  query: async ({ input, ctx }) => {
    return ctx.db.table('orders').execute()
  }
})
```

### Step 2: Replace define with serve

**Before:**
```typescript
const api = define({
  queries: { revenue }
})
```

**After:**
```typescript
import { serve } from '@hypequery/serve'

const api = serve({
  revenue,
  context: () => ({ db })
})
```

## Backward Compatibility

The old API still works:

```typescript
// This still works
const { define, query } = initServe({ context: () => ({ db }) })
const api = define({ queries: { revenue: query(...) } })
```

You can migrate incrementally - no rush!
```

---

## Timeline

### Week 1: Core Implementation

- **Day 1-2**: Implement `query()` and `serve()`
- **Day 3**: Update `defineServe` to support query objects
- **Day 4**: Add tests
- **Day 5**: Internal testing and bug fixes

### Week 2: Documentation

- **Day 1-2**: Update getting started guide
- **Day 3**: Add migration guide
- **Day 4**: Update examples
- **Day 5**: Proofread and publish

### Week 3-4: Beta Testing

- **Week 3**: Share with 10-20 users
- **Week 4**: Gather feedback and fix issues

### Week 5+: Launch

- Based on feedback, decide on deprecation timeline for old API

---

## Success Metrics

### Week 1-2:
- ✅ All tests pass
- ✅ No breaking changes to existing code
- ✅ Types work correctly

### Week 3-4:
- ✅ 50%+ of beta users prefer new API
- ✅ Can migrate real queries without issues
- ✅ Documentation is clear

### Week 5+:
- ✅ 70%+ of new users use new API
- ✅ 30%+ of existing users migrate voluntarily
- ✅ No increase in support requests

---

## Risks and Mitigations

### Risk: Type complexity with query objects

**Mitigation:**
- Keep types simple initially
- Use `any` strategically if needed
- Add comprehensive type tests

### Risk: Users confused by two APIs

**Mitigation:**
- Clearly label new API as "recommended"
- Keep old API in "advanced" section
- Add "Which should I use?" guide

### Risk: Breaking existing code

**Mitigation:**
- Comprehensive test suite
- Beta testing with real users
- Gradual rollout

---

## Next Steps

1. **Review this plan** with team
2. **Create proof of concept** (1 day)
3. **Test with 5 users** before full implementation
4. **Iterate based on feedback**
5. **Full implementation** (2 weeks)
6. **Launch and measure**

**Key insight:** This is a low-risk change because it's additive. The worst case is users don't adopt it, and you're back where you started (but with better understanding of what users want).

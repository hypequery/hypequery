# HypeQuery: What's Actually Missing (Foundational Analysis)

## The Real Question

You asked whether inaction is the path forward. Here's the honest answer: **no, but feature additions aren't either.** Your problem isn't missing features — it's that the existing features have gaps that would stop a real production user at the door.

---

## The Three Things Killing Adoption Right Now

### 1. The Wiring Tax

Every hypequery user must manually:

1. Create a catch-all route handler (`app/api/hypequery/[...hq]/route.ts`)
2. Register every query as a route with `.route('/name', api.queries.name, { method: 'POST' })`
3. Create a client hooks file with manual type imports and method config
4. Configure a React Query provider
5. Set up proxy config (Vite) or catch-all routes (Next.js)

Your competitors (tRPC, Convex) generate or eliminate all of this. A developer evaluating hypequery hits this wall in the first 30 minutes and bounces.

**Evidence from your own examples**: Your `next-dashboard` example has ~50 lines of pure wiring boilerplate that provides zero business value. Your `vite-starter` requires understanding a two-server architecture just to call a query.

**What to fix**: Auto-routing. When you define queries in `defineServe`, every query should automatically get a route at `/{basePath}/{queryName}`. The manual `.route()` calls should become optional overrides, not the default. This is one architectural change that removes 30% of the boilerplate from every example.

### 2. Type Safety Breaks at the Execution Boundary

Your core selling point is TypeScript-first analytics. But look at your own examples:

```typescript
// From next-dashboard queries.ts
return {
  total: toNumber((result as any).total_amount_avg),
  tips: toNumber((result as any).tip_amount_avg),
};
```

Every query result gets cast to `any`. The type-safe query builder generates SQL, ClickHouse returns JSON, and the types are lost. Your generated `IntrospectedSchema` maps columns to ClickHouse types, but the query builder's `execute()` returns rows where the column values are strings (ClickHouse JSON returns everything as strings).

This is the gap between promise and reality. You advertise type safety, but the last mile — where developers actually use the data — requires `as any`.

**What to fix**: The query builder's `execute()` should optionally validate/coerce results against the schema types. When you `select(['amount', 'count'])`, the returned objects should have `amount: number` and `count: number`, not `amount: string`. This can be a Zod-based runtime coercion step tied to your schema types.

### 3. The Serve Layer Isn't Production-Safe

The serve layer (v0.0.4) has gaps that would block any serious deployment:

| Gap | Impact |
|-----|--------|
| No request body size limit | Memory exhaustion on large POST |
| No handler timeout | Hanging requests consume connections forever |
| No structured logging | Can't debug anything in production |
| No CORS support in node adapter | Browser-based clients can't connect |
| No request-id correlation | Can't trace requests across query builder + serve |
| Graceful shutdown doesn't drain connections | Deploys drop in-flight requests |
| OpenAPI spec cached forever | Hot-reload doesn't update docs |

These aren't features — they're table stakes. A developer who gets past the wiring tax hits these and concludes "this isn't production-ready" within a week.

---

## What You Should Actually Build (In Order)

### Priority 1: Remove the Wiring Tax

**Auto-routing** (the single highest-leverage change):

```typescript
// BEFORE: Manual route registration for every query
const api = defineServe({
  queries: { revenue, trips, stats },
});
api.route('/revenue', api.queries.revenue, { method: 'POST' });
api.route('/trips', api.queries.trips, { method: 'POST' });
api.route('/stats', api.queries.stats, { method: 'GET' });

// AFTER: Queries auto-route by name, method from builder
const api = defineServe({
  basePath: '/api/analytics',
  queries: { revenue, trips, stats },
  // All queries automatically available at /api/analytics/{name}
  // Method derived from query builder (.method('POST'))
  // Override with .route() only when you need custom paths
});
```

This requires changes to `server.ts` (register routes automatically in `defineServe`) and `router.ts` (register during construction). Roughly 50-80 lines of changes.

**Framework scaffolding in CLI**:

```bash
npx hypequery init --framework next
# Generates:
# - analytics/client.ts
# - analytics/schema.ts
# - analytics/queries.ts
# - app/api/hypequery/[...hq]/route.ts  ← NEW
# - lib/hypequery-client.ts              ← NEW
```

This requires adding framework templates to the CLI's `init` command. Roughly 100-150 lines.

### Priority 2: Make the Serve Layer Production-Safe

These are all changes to `@hypequery/serve`:

1. **Request body size limit** — Add `maxBodySize` option to node adapter, default 1MB. ~20 lines in `adapters/node.ts`.

2. **Handler timeout** — Add `timeoutMs` option to `defineServe`, wrap handler execution in `Promise.race`. ~30 lines in `pipeline.ts`.

3. **Structured logging** — Create a `ServeLogger` that your pipeline uses instead of `console.error`. Accept a user-provided logger or default to structured console output. Correlate `requestId` through query execution. ~100 lines.

4. **CORS middleware** — Ship a `cors()` middleware that users can add with `.use(cors())`. ~60 lines.

5. **Graceful shutdown** — Track in-flight requests, wait for drain on SIGTERM. ~40 lines in `adapters/node.ts`.

6. **OpenAPI cache invalidation** — Invalidate cached OpenAPI spec on hot reload. ~10 lines.

Total: ~260 lines. This makes the serve layer honestly deployable.

### Priority 3: Fix the Type Safety Promise

This is the work that makes your differentiator real:

1. **Result coercion** — When `execute()` returns rows from ClickHouse, coerce string values to their schema types (numbers, dates, booleans). This can be a configurable step. ~150 lines in the executor.

2. **End-to-end type example** — Rewrite your examples to demonstrate zero `as any` casts. If you can't do it, the types aren't good enough yet.

### Priority 4: Your In-Progress Work (Auth Helpers + Logging)

Your auth branches (`.requireAuth()`, `.requireRole()`, `.requireScope()`, `.public()`) are the right work at the right time. They:

- Remove boilerplate (users don't write their own auth middleware)
- Reinforce your tRPC-style DX differentiator
- Are composable with the existing pipeline

The logging upgrade is also correct if it means unified structured logging across serve + query execution with request-id correlation. That's the missing observability foundation.

Promoting caching to the serve layer also makes sense — the serve layer already has `cacheTtlMs` and cache-control headers, but it's disconnected from the query builder's cache. Unifying these gives you a single caching story instead of two half-stories.

### Priority 5: The Things You Mentioned That Can Wait

| Feature | Verdict |
|---------|---------|
| `hypequery diff` (schema drift) | Good but not blocking adoption |
| `hypequery seed` (test data) | Nice-to-have, not urgent |
| `@hypequery/test` | Useful after people write enough queries to need tests |
| CI templates | Free to ship but won't drive adoption |
| Rate limiting | Can wait until someone asks |
| WebSocket streaming | Can wait until someone needs real-time |

---

## On PMF and Inaction

Inaction is wrong because your library has genuine friction that repels users before they can evaluate the core value. You're not missing a killer feature — you're missing the absence of pain.

More features are also wrong because they increase surface area without fixing the friction. Auth helpers are an exception because they're reducing wiring tax, not adding features.

**The strategy**: Make the existing happy path frictionless. One command to start. Zero manual wiring. Types that work end-to-end. A serve layer that doesn't fall over. Then talk to every early user personally and build what they ask for.

You're building in the right space (TypeScript-first ClickHouse analytics), with the right architecture (tRPC-style procedure builder), at the right time (ClickHouse adoption is growing fast). The gap isn't vision — it's polish.

---

## Concrete Next Steps

1. **Auto-routing in defineServe** — Highest leverage single change
2. **Ship auth helpers** (your existing branches) — Reduces wiring tax
3. **Serve layer hardening** (timeouts, body limits, CORS, shutdown) — Makes it deployable
4. **Unified structured logging** (your existing branch) — Makes it debuggable
5. **Framework scaffolding in CLI** — Eliminates first-30-minutes dropout
6. **Result type coercion** — Makes the TypeScript promise real
7. **Promote caching to serve** (your existing plan) — Single coherent caching story
8. **Rewrite examples with zero `as any`** — Prove the DX works end-to-end

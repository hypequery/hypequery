---
title: "ClickHouse React Hooks: Type-Safe Data Fetching Without the Boilerplate"
description: "@hypequery/react generates typed React hooks from the same query definitions that back your HTTP API. No manual useState/useEffect, no type drift between server and client."
seoTitle: "ClickHouse React Hooks: Generated, Type-Safe, Zero Boilerplate"
seoDescription: "Stop hand-rolling ClickHouse data fetching in React. @hypequery/react generates typed hooks from your query definitions. Types flow from the schema to your components."
pubDate: 2026-04-23
heroImage: ""
slug: clickhouse-react-hooks
status: published
---

Most React + ClickHouse setups look something like this:

```typescript
function RevenueChart() {
  const [data, setData] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch("/api/revenue")
      .then(res => res.json())
      .then(rows => {
        setData(rows)
        setLoading(false)
      })
      .catch(err => {
        setError(err)
        setLoading(false)
      })
  }, [])

  if (loading) return <Spinner />
  if (error) return <ErrorState error={error} />
  return <Chart data={data} />
}
```

This works. But the return type is `any[]`, so every downstream use of `data` is untyped. The fetch URL is a string that can drift from the actual endpoint. Loading and error state is duplicated across every component that fetches data. When the query changes, the component has no way to know.

`@hypequery/react` replaces this pattern with generated hooks that are typed from the schema and shared with the same query definitions your API uses.

## How it works

hypequery's query objects — the same ones you pass to `serve({ queries })` — can also be used to generate React hooks. The hook knows the query's return type because it was inferred when you defined the query.

```typescript
// queries.ts — defined once, shared across contexts
import { initServe } from "@hypequery/serve"
import { db } from "./db"

const { query, serve } = initServe({ context: () => ({ db }) })

export const revenue = query({
  query: async ({ ctx }) =>
    ctx.db.table("orders")
      .select("order_date", "total_revenue", "order_count")
      .where("status", "=", "completed")
      .groupBy("order_date")
      .orderBy("order_date", "DESC")
      .limit(30)
      .execute()
})

export const api = serve({ queries: { revenue } })
```

```typescript
// hooks.ts — generated hooks from the same query definitions
import { createHooks } from "@hypequery/react"
import { revenue } from "./queries"

export const { useRevenue } = createHooks({ revenue })
```

```typescript
// RevenueChart.tsx
import { useRevenue } from "./hooks"

function RevenueChart() {
  const { data, loading, error } = useRevenue()
  // data: { order_date: string; total_revenue: string; order_count: string }[]
  // fully typed — matches what ClickHouse actually returns

  if (loading) return <Spinner />
  if (error) return <ErrorState error={error} />
  return <Chart data={data} />
}
```

The hook handles loading, error, and data state. The return type is inferred from the query definition. When the schema changes and you regenerate types, any component using the hook gets a type error at compile time — not a runtime surprise.

## What createHooks generates

`createHooks()` takes an object of query definitions and returns a hook per query. Pass `{ revenue }`, get back `{ useRevenue }`.

Each hook returns:

```typescript
{
  data: T[]        // the query's inferred row type
  loading: boolean
  error: Error | null
  refetch: () => void
}
```

## With parameters

If your query accepts inputs, the hook takes them as arguments:

```typescript
export const revenueByRange = query({
  input: z.object({ from: z.string(), to: z.string() }),
  query: async ({ ctx, input }) =>
    ctx.db.table("orders")
      .where("order_date", ">=", input.from)
      .where("order_date", "<=", input.to)
      .select("order_date", "total_revenue")
      .execute()
})

const { data } = useRevenueByRange({ from: "2026-01-01", to: "2026-01-31" })
//                                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                   TypeScript enforces this shape
```

## With multi-tenancy

Pass tenant context via headers:

```typescript
export const { useRevenue } = createHooks(
  { revenue },
  {
    headers: () => ({
      "x-tenant-id": getCurrentTenantId(),
    }),
  }
)
```

Tenant isolation lives at the query definition level — the hook just passes the header through. The component doesn't need to know about tenancy at all.

## Before and after

**Before — raw fetch, manual types, duplicated state logic:**

```typescript
const [data, setData] = useState<any[]>([])   // untyped
const [loading, setLoading] = useState(false)  // duplicated everywhere
useEffect(() => {
  fetch("/api/revenue")                        // string URL, can drift
    .then(r => r.json())
    .then(setData)
}, [])
```

**After — generated hook, inferred types, zero boilerplate:**

```typescript
const { data, loading, error } = useRevenue()
// data: { order_date: string; total_revenue: string }[]
// typed from the schema. same definition as the HTTP endpoint.
```

## Getting started

```bash
npm install @hypequery/clickhouse @hypequery/react @hypequery/serve
npx @hypequery/cli generate
```

`@hypequery/react` requires `@hypequery/serve` for the shared query definitions. If you're already using the serve layer, adding React hooks is a one-line change.

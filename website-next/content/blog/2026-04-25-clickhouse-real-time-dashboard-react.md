---
title: "Building a Real-Time ClickHouse Dashboard with React and hypequery"
description: "A full walkthrough — schema generation, typed query endpoints, React hooks, and a polling dashboard that stays live without WebSockets."
seoTitle: "ClickHouse Real-Time Dashboard — React Hooks and TypeScript"
seoDescription: "Build a real-time analytics dashboard on ClickHouse using React, hypequery, and typed HTTP APIs. Polling, live updates, and typed chart components."
pubDate: 2026-04-25
heroImage: ""
slug: clickhouse-real-time-dashboard-react
status: published
---

ClickHouse is fast at aggregations. A query that scans 100 million rows and returns aggregated results in under a second makes polling a perfectly reasonable strategy for real-time dashboards — no WebSockets, no streaming, just fetch and refresh. This post walks through the full stack: schema, query definitions, typed HTTP endpoints, React hooks, and a live dashboard component.

## Step 1: Generate the Schema

With a ClickHouse instance running and an `events` table created, generate TypeScript types:

```bash
npx @hypequery/cli generate --output ./src/schema.ts
```

This produces a typed schema object. All subsequent query builder calls are validated against it.

## Step 2: Define the Analytics Queries

Create a server-side module with the queries your dashboard needs:

```typescript
// server/queries/analytics.ts
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { Schema } from '../schema';
import { z } from 'zod';

export const db = createQueryBuilder<Schema>({
  host: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

// Daily active users for a given date
export async function getDau(date: string) {
  const rows = await db
    .table('events')
    .select('uniq(user_id) as dau')
    .where('toDate(created_at)', 'eq', date)
    .execute();
  return Number(rows[0]?.dau ?? 0);
}

// Event counts broken down by type, last 24 hours
export async function getEventsByType() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);

  return db
    .table('events')
    .select('event_type', 'count() as event_count')
    .where('created_at', 'gte', since)
    .groupBy('event_type')
    .orderBy('event_count', 'DESC')
    .execute();
}

// Top 10 pages by view count today
export async function getTopPages(date: string) {
  return db
    .table('events')
    .select('page_path', 'count() as views')
    .where('event_type', 'eq', 'page_view')
    .where('toDate(created_at)', 'eq', date)
    .groupBy('page_path')
    .orderBy('views', 'DESC')
    .limit(10)
    .execute();
}
```

## Step 3: Expose Typed HTTP Endpoints with @hypequery/serve

```typescript
// server/index.ts
import { initServe, query, serve } from '@hypequery/serve';
import { z } from 'zod';
import { db, getDau, getEventsByType, getTopPages } from './queries/analytics';

const { query: q } = initServe({
  context: (req) => ({ db }),
});

const analyticsQueries = {
  dau: q({
    input: z.object({ date: z.string() }),
    query: async ({ input }) => {
      const dau = await getDau(input.date);
      return { dau };
    },
  }),
  eventsByType: q({
    input: z.object({}),
    query: async () => getEventsByType(),
  }),
  topPages: q({
    input: z.object({ date: z.string() }),
    query: async ({ input }) => getTopPages(input.date),
  }),
};

serve({ queries: analyticsQueries, port: 3001 });
```

## Step 4: Create React Hooks with @hypequery/react

```typescript
// src/hooks/analytics.ts
import { createHooks } from '@hypequery/react';

// Point at your serve endpoint
export const { useQuery } = createHooks({
  baseUrl: 'http://localhost:3001',
});
```

## Step 5: Build the Dashboard

```tsx
// src/components/Dashboard.tsx
import React, { useEffect, useState } from 'react';
import { useQuery } from '../hooks/analytics';

function useTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function DauCard() {
  const today = useTodayDate();
  const { data, loading, error } = useQuery('dau', { date: today }, {
    refetchInterval: 30_000,  // Poll every 30 seconds
  });

  if (loading) return <div className="card">Loading...</div>;
  if (error) return <div className="card error">Failed to load DAU</div>;

  return (
    <div className="card">
      <h2>Daily Active Users</h2>
      <p className="metric">{data?.dau.toLocaleString()}</p>
    </div>
  );
}

function EventBreakdown() {
  const { data, loading } = useQuery('eventsByType', {}, {
    refetchInterval: 15_000,
  });

  if (loading) return <div className="card">Loading...</div>;

  return (
    <div className="card">
      <h2>Events (Last 24h)</h2>
      <table>
        <thead>
          <tr><th>Event Type</th><th>Count</th></tr>
        </thead>
        <tbody>
          {data?.map((row) => (
            <tr key={row.event_type}>
              <td>{row.event_type}</td>
              <td>{Number(row.event_count).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TopPages() {
  const today = useTodayDate();
  const { data, loading } = useQuery('topPages', { date: today }, {
    refetchInterval: 60_000,
  });

  if (loading) return <div className="card">Loading...</div>;

  return (
    <div className="card">
      <h2>Top Pages Today</h2>
      <ol>
        {data?.map((row) => (
          <li key={row.page_path}>
            <span>{row.page_path}</span>
            <span>{Number(row.views).toLocaleString()} views</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function Dashboard() {
  return (
    <div className="dashboard">
      <DauCard />
      <EventBreakdown />
      <TopPages />
    </div>
  );
}
```

## How Type Safety Flows End-to-End

The type guarantees chain from bottom to top:

1. **ClickHouse schema** → `npx @hypequery/cli generate` → TypeScript types in `schema.ts`
2. **schema.ts** → `createQueryBuilder<Schema>({...})` → query builder methods typed against real columns
3. **Query builder** → function return types → TypeScript knows the shape of each query result
4. **`@hypequery/serve`** → typed endpoint definitions → response types exported
5. **`createHooks()`** → `useQuery('dau', ...)` → `data` is typed as `{ dau: number }`

If you rename a column in ClickHouse and regenerate the schema, TypeScript will flag every query that references the old column name. You catch the breakage before it reaches production.

## Why Polling Works Well Here

Polling every 15–30 seconds is simple to implement, easy to reason about, and perfectly adequate for most analytics dashboards. ClickHouse's aggregation speed means a refresh query typically completes in under 500ms even on large datasets. The result: a dashboard that feels live without any streaming infrastructure.

If you need sub-second updates, ClickHouse also supports HTTP streaming and you can pipe results as they arrive — but for a management dashboard showing DAU and event breakdowns, polling is the right default.

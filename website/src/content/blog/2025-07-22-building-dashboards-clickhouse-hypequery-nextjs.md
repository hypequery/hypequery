---
layout: blog
title: "Building Dashboards on ClickHouse with hypequery and Next.js"
description: "Learn how to build type-safe, real-time analytics dashboards using hypequery, ClickHouse, and Next.js. Get complete type safety, autocomplete, and developer productivity for your analytics applications."
pubDate: 2025-07-22
heroImage: ""
---

Modern analytics applications demand both real-time insights and developer productivity. If you're building dashboards on ClickHouse with TypeScript, you've likely run into the pain of raw SQL strings, manual type definitions, and the challenges of interactive, scalable data apps. In this guide, we'll show you how to solve these problems using hypequery — a TypeScript-first, type-safe query builder for ClickHouse — alongside Next.js, the leading React framework.

**You can check hypequery out on [github](https://github.com/hypequery/hypequery)**.

## Why ClickHouse + TypeScript for Dashboards?

ClickHouse is an industry-leading analytical database, purpose-built for high-performance, real-time analytics. TypeScript, meanwhile, brings type safety and modern tooling to JavaScript development. But connecting the two has historically meant sacrificing type safety, maintainability, or both.

**hypequery bridges this gap by providing:**
- A fully type-safe query builder tailored for ClickHouse
- Autocomplete and type validation for every part of your query
- Features designed for dashboard development: cross-filtering, streaming, and more

### The Challenge

Real-Time Dashboards Without the Pain

Traditional approaches to dashboard development with ClickHouse and TypeScript are fraught with issues:

- **Raw SQL strings**: Prone to runtime errors and SQL injection
- **Manual type definitions**: Tedious to maintain and easily out of sync
- **Complex query management**: Difficult to build interactive, cross-filtered dashboards
- **Handling large result sets**: Risk of memory issues and slow performance

### The Solution: hypequery

hypequery is a TypeScript SDK and query builder for ClickHouse, designed specifically for real-time, type-safe analytics dashboards. Its core features include:

- **Complete Type Safety**: Every query is type-checked, from table and column names to filter values and result types. Get autocomplete and instant feedback in your IDE
- **Flexible Join System**: Fluent API for all join types, with support for custom relationships and smart aliasing
- **SQL Expressions & Functions**: Use ClickHouse-specific functions and raw SQL expressions while maintaining type safety
- **Streaming Support**: Efficiently process large result sets with streaming, ideal for real-time dashboards and monitoring
- **Advanced Filtering**: Build complex, reusable filters and apply cross-filtering logic across multiple queries
- **Comprehensive Logging**: Track queries, parameters, execution times, and row counts for observability
- **Schema Generation**: CLI tool to generate TypeScript types directly from your ClickHouse schema, keeping your types in sync

## Getting Started: Setting Up hypequery with Next.js

### 1. Install Dependencies

```bash
npm install @hypequery/clickhouse @clickhouse/client
npm install next react react-dom
```

### 2. Generate TypeScript Types from Your ClickHouse Schema

Use the CLI to introspect your schema and generate types:

```bash
npx hypequery-generate --host your-clickhouse-host --database your-database
```

This creates a `generated-schema.ts` file you'll import in your app.

### 3. Initialize the Query Builder and Build a Query

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated-schema';

const db = createQueryBuilder<IntrospectedSchema>({
  host: 'your-clickhouse-host',
  username: 'default',
  password: '',
  database: 'default'
});

// Example: Fetch top 10 recent trips with fares over $50
const results = await db
  .table('trips')
  .select(['pickup_datetime', 'dropoff_datetime', 'total_amount'])
  .where('total_amount', '>', 50)
  .orderBy('pickup_datetime', 'DESC')
  .limit(10)
  .execute();
```

- Column names are type-checked, typos or missing columns are caught at compile time
- Query results are fully typed, no more `any` or manual casting

### 4. Cross-Filtering for Interactive Dashboards

Interactive dashboards often need to synchronize filters across multiple queries. hypequery's CrossFilter makes this easy:

```typescript
import { CrossFilter } from '@hypequery/clickhouse';

const filter = new CrossFilter()
  .add({ column: 'pickup_datetime', operator: 'gte', value: '2024-01-01' })
  .add({ column: 'total_amount', operator: 'gt', value: 20 });

const trips = await db.table('trips').applyCrossFilters(filter).execute();
const drivers = await db.table('drivers').applyCrossFilters(filter).execute();
```

### 5. Integrate with Next.js API Routes

In your Next.js app, create an API route that fetches data using hypequery:

```typescript
// pages/api/trips.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../lib/db'; // your hypequery instance

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const data = await db.table('trips')
    .select(['pickup_datetime', 'total_amount'])
    .orderBy('pickup_datetime', 'DESC')
    .limit(10)
    .execute();
  res.status(200).json(data);
}
```

Type safety is preserved from the database to your frontend.

### 6. Display Data in Your Next.js Dashboard

Use React components to fetch and display the data:

```typescript
// components/TripsTable.tsx
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(res => res.json());

export default function TripsTable() {
  const { data, error } = useSWR('/api/trips', fetcher);
  
  if (error) return <div>Error loading data</div>;
  if (!data) return <div>Loading...</div>;
  
  return (
    <table>
      <thead>
        <tr>
          <th>Pickup</th>
          <th>Dropoff</th>
          <th>Total Amount</th>
        </tr>
      </thead>
      <tbody>
        {data.map((trip: any) => (
          <tr key={trip.pickup_datetime}>
            <td>{trip.pickup_datetime}</td>
            <td>{trip.dropoff_datetime}</td>
            <td>{trip.total_amount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## Why Use hypequery for Real-Time Dashboards?

- **Type safety at every step**: No more runtime surprises or mismatched columns
- **Developer productivity**: Autocomplete, instant error checking, and less boilerplate
- **Built for analytics**: Features like cross-filtering and streaming are designed for dashboard use cases
- **Works everywhere**: Node.js and browser support for flexible deployments

## Conclusion

If you're building real-time dashboards on ClickHouse with TypeScript and Next.js, hypequery provides the type safety, developer experience, and analytics features you need to ship faster and with confidence.

**Ready to build?**

Install hypequery and start building your type-safe analytics dashboard today:

```bash
npm install @hypequery/clickhouse
```

Explore the **[hypequery documentation](/docs)** for more examples and advanced features. 

**hypequery ClickHouse API**

***

# hypequery

<div align="center">
  <img src="https://hypequery.dev/img/logo.svg" alt="hypequery Logo" width="200"/>
  <h1>@hypequery/clickhouse</h1>
  <p>A typescript-first library for building type-safe dashboards with ClickHouse</p>
  
  [![GitHub license](https://img.shields.io/github/license/lukejreilly/hypequery)](https://github.com/lukejreilly/hypequery/blob/main/LICENSE)
  [![npm version](https://badge.fury.io/js/@hypequery%2Fcore.svg)](https://badge.fury.io/js/@hypequery%2Fcore)
  [![GitHub stars](https://img.shields.io/github/stars/lukejreilly/hypequery)](https://github.com/lukejreilly/hypequery/stargazers)
</div>

> **Note:** This package is published on npm as `@hypequery/core`. The unscoped package `hypequery-core` is unrelated and should not be used.

## Overview

hypequery is a typescript-first query builder for ClickHouse designed specifically for building real-time, type-safe analytics dashboards. Unlike generic SQL query builders, hypequery understands your ClickHouse schema and provides full type checking throughout your codebase, making it ideal for data-intensive applications.

## Features

- 🎯 **Type-Safe**: Full TypeScript support with inferred types from your ClickHouse schema
- 🚀 **Performant**: Built for real-time analytics with optimized query generation
- 🔍 **Cross Filtering**: Powerful cross-filtering capabilities for interactive dashboards
- 📊 **Dashboard Ready**: Built-in support for pagination, sorting, and filtering
- 🛠️ **Developer Friendly**: Fluent API design for an intuitive development experience
- 📱 **Platform Agnostic**: Works in both Node.js and browser environments
- 🔄 **Schema Generation**: CLI tool to generate TypeScript types from your ClickHouse schema

## Installation

```bash
# npm
npm install @hypequery/core

# yarn
yarn add @hypequery/core

# pnpm
pnpm add @hypequery/core
```

## Quick Start

```typescript
import { createQueryBuilder } from '@hypequery/core';
import type { Schema } from './generated-schema';

// Initialize the query builder
const db = createQueryBuilder<Schema>({
  host: 'your-clickhouse-host',
  username: 'default',
  password: '',
  database: 'default'
});

// Build and execute a query
const results = await db
  .table('trips')
  .select(['pickup_datetime', 'dropoff_datetime', 'total_amount'])
  .where('total_amount', '>', 50)
  .orderBy('pickup_datetime', 'DESC')
  .limit(10)
  .execute();
```

## Schema Generation

hypequery provides a CLI tool to generate TypeScript types from your ClickHouse schema:

```bash
# Install globally (optional)
npm install -g @hypequery/core

# Generate schema types
npx hypequery-generate --host your-clickhouse-host --database your-database
```

This creates a `generated-schema.ts` file that you can import in your application:

```typescript
import { createQueryBuilder } from '@hypequery/core';
import type { IntrospectedSchema } from './generated-schema';

const db = createQueryBuilder<IntrospectedSchema>({
  // connection details
});
```

## Core Features

### Type-Safe Queries

hypequery provides full TypeScript support, ensuring your queries are type-safe:

```typescript
// Column names are type-checked
const query = db.table('trips')
  .select(['pickup_datetime', 'total_amount']) 
  .where('total_amount', '>', 50)
  .execute();

// Type error if column doesn't exist
db.table('trips').select(['non_existent_column']); // TypeScript error
```

### Cross Filtering

Implement interactive dashboards with cross-filtering support:

```typescript
import { CrossFilter } from '@hypequery/core';

// Create a filter
const filter = new CrossFilter()
  .add({
    column: 'pickup_datetime',
    operator: 'gte',
    value: '2024-01-01'
  })
  .add({
    column: 'total_amount',
    operator: 'gt',
    value: 20
  });

// Apply to multiple queries
const query1 = db.table('trips')
  .applyCrossFilters(filter)
  .execute();

const query2 = db.table('drivers')
  .applyCrossFilters(filter)
  .execute();
```

### Pagination

Built-in cursor-based pagination for efficient data loading:

```typescript
// First page
const firstPage = await db.table('trips')
  .select(['pickup_datetime', 'total_amount'])
  .orderBy('pickup_datetime', 'DESC')
  .paginate({
    pageSize: 10
  });

// Next page
const nextPage = await db.table('trips')
  .select(['pickup_datetime', 'total_amount'])
  .orderBy('pickup_datetime', 'DESC')
  .paginate({
    pageSize: 10,
    after: firstPage.pageInfo.endCursor
  });

// Previous page
const prevPage = await db.table('trips')
  .select(['pickup_datetime', 'total_amount'])
  .orderBy('pickup_datetime', 'DESC')
  .paginate({
    pageSize: 10,
    before: nextPage.pageInfo.startCursor
  });
```

### Advanced Queries

hypequery supports complex queries including joins, aggregations, and subqueries:

```typescript
// Aggregations
const stats = await db.table('trips')
  .avg('total_amount')
  .max('trip_distance')
  .count('trip_id')
  .where('pickup_datetime', '>=', '2024-01-01')
  .execute();

// Joins
const tripsWithDrivers = await db.table('trips')
  .select(['trips.trip_id', 'trips.total_amount', 'drivers.name'])
  .join('drivers', 'trips.driver_id', '=', 'drivers.id')
  .execute();

// Raw SQL when needed
const customQuery = await db.table('trips')
  .select([
    db.raw('toStartOfDay(pickup_datetime) as day'),
    'count() as trip_count'
  ])
  .groupBy(db.raw('toStartOfDay(pickup_datetime)'))
  .execute();
```

## Environment Support

### Browser Environment

For browser usage, you'll typically need to set up a proxy server to avoid CORS issues:

```typescript
const db = createQueryBuilder<Schema>({
  host: '/api/clickhouse', // Proxy through your API route
  username: 'default',
  password: '',
  database: 'default'
});
```

### Node.js Environment

For server-side applications, you can connect directly to ClickHouse:

```typescript
const db = createQueryBuilder<Schema>({
  host: 'http://your-clickhouse-server:8123',
  username: 'default',
  password: 'your-password',
  database: 'default'
});
```

## Versioning and Release Channels

hypequery follows semantic versioning and provides multiple release channels:

- **Latest**: Stable releases (`npm install @hypequery/core`)
- **Beta**: Pre-release versions (`npm install @hypequery/core@beta`)

## Documentation

For detailed documentation and examples, visit our [documentation site](https://hypequery.dev/docs).

- [Getting Started](https://hypequery.dev/docs/installation)
- [Query Building](https://hypequery.dev/docs/guides/query-building)
- [Filtering](https://hypequery.dev/docs/guides/filtering)
- [Pagination](https://hypequery.dev/docs/features/pagination)
- [API Reference](https://hypequery.dev/docs/reference/api)

## Examples

Check out our example implementations:

- [Example Dashboard](https://github.com/lukejreilly/hypequery/tree/main/examples/example-dashboard): A complete Next.js dashboard with hypequery
- [React Query Integration](https://hypequery.dev/docs/guides/integrations/react-query): Using hypequery with React Query
- [Time Series Analysis](https://hypequery.dev/docs/guides/timeseries): Building time series analytics

## Troubleshooting

### Common Issues

- **Connection Errors**: Ensure your ClickHouse server is running and accessible
- **CORS Issues**: Use a proxy server for browser environments
- **Type Errors**: Make sure to regenerate your schema types after schema changes

## Contributing

We welcome contributions! Please see our [contributing guide](CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- 📚 [Documentation](https://hypequery.dev/docs)
- 🐛 [Issue Tracker](https://github.com/lukejreilly/hypequery/issues)
- 💬 [Discussions](https://github.com/lukejreilly/hypequery/discussions)

---

<div align="center">
  <sub>Built with ❤️ by the hypequery team</sub>
</div>

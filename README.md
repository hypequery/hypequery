# hypequery

<div align="center">
  <img src="https://hypequery.com/img/logo.svg" alt="hypequery Logo" width="200"/>
  <h1>@hypequery/clickhouse</h1>
  <p>A typescript-first library for building type-safe dashboards with ClickHouse</p>
  
  [![GitHub license](https://img.shields.io/github/license/hypequery/hypequery)](https://github.com/hypequery/hypequery/blob/main/LICENSE)
  [![npm version](https://badge.fury.io/js/@hypequery%2Fclickhouse.svg)](https://badge.fury.io/js/@hypequery%2Fclickhouse)
  [![GitHub stars](https://img.shields.io/github/stars/hypequery/hypequery)](https://github.com/hypequery/hypequery/stargazers)
</div>


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
- 🔧 **Flexible Client Support**: Manual injection or automatic client selection with fallback

## Installation

This library requires one of the following ClickHouse clients as a peer dependency:

### For Node.js environments
```bash
npm install @hypequery/clickhouse @clickhouse/client
```

### For browser/universal environments
```bash
npm install @hypequery/clickhouse @clickhouse/client-web
```
```

**Note**: The library supports multiple client selection strategies:
- **Manual injection**: Explicitly provide a client instance (required for browser environments)
- **Auto-detection with fallback**: Automatically selects the client for Node.js environments
- **Browser environments**: Require manual injection because `require()` calls don't work in browsers

## Quick Start

### Method 1: Manual Injection (Required for Browser Environments)

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import { createClient } from '@clickhouse/client-web';
import type { IntrospectedSchema } from './generated-schema';

// Create the ClickHouse client explicitly
const client = createClient({
  host: 'your-clickhouse-host',
  username: 'default',
  password: '',
  database: 'default'
});

// Initialize the query builder with the client
const db = createQueryBuilder<IntrospectedSchema>({
  host: 'your-clickhouse-host',
  database: 'default',
  client // Explicitly provide the client
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

### Method 2: Auto-Detection (Node.js Environments Only)

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import type { IntrospectedSchema } from './generated-schema';

// Initialize the query builder
const db = createQueryBuilder<IntrospectedSchema>({
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
npm install -g @hypequery/clickhouse

# Generate schema types
npx hypequery-generate-types --host your-clickhouse-host --database your-database
```

This creates a `generated-schema.ts` file that you can import in your application:

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
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
import { CrossFilter } from '@hypequery/clickhouse';

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

### Client Selection Strategies

hypequery supports multiple approaches for client selection:

#### 1. Manual Injection (Required for Browser Environments)

```typescript
import { createClient } from '@clickhouse/client-web';

const client = createClient({
  host: 'your-clickhouse-host',
  username: 'default',
  password: '',
  database: 'default'
});

const db = createQueryBuilder<IntrospectedSchema>({
  host: 'your-clickhouse-host',
  database: 'default',
  client // Explicitly provide the client
});
```

**Benefits:**
- ✅ Works in all environments (Node.js, browser, bundlers)
- ✅ Explicit control over client configuration
- ✅ Required for browser environments (require() doesn't work in browsers)
- ✅ Synchronous API throughout

#### 2. Auto-Detection with Fallback (Node.js Environments Only)

```typescript
const db = createQueryBuilder<IntrospectedSchema>({
  host: 'your-clickhouse-host',
  username: 'default',
  password: '',
  database: 'default'
});
```

**Client Selection Logic:**
- **Node.js environments**: Uses `@clickhouse/client` (better performance and features)
- **Fallback**: If `@clickhouse/client` is not available, falls back to `@clickhouse/client-web`

**Note**: Auto-detection only works in Node.js environments. Browser environments require manual injection.

### Browser Environment

For browser usage, you'll typically need to set up a proxy server to avoid CORS issues:

```typescript
// Manual injection (required for browser environments)
import { createClient } from '@clickhouse/client-web';

const client = createClient({
  host: '/api/clickhouse', // Proxy through your API route
  username: 'default',
  password: '',
  database: 'default'
});

const db = createQueryBuilder<IntrospectedSchema>({
  host: '/api/clickhouse',
  database: 'default',
  client
});
```

**Note**: Auto-detection doesn't work in browser environments because `require()` calls don't work in browsers. Manual injection is required.

### Node.js Environment

For server-side applications, you can connect directly to ClickHouse:

```typescript
// Method 1: Manual injection
import { createClient } from '@clickhouse/client';

const client = createClient({
  host: 'http://your-clickhouse-server:8123',
  username: 'default',
  password: 'your-password',
  database: 'default'
});

const db = createQueryBuilder<IntrospectedSchema>({
  host: 'http://your-clickhouse-server:8123',
  database: 'default',
  client
});

// Method 2: Auto-detection (works well in Node.js)
const db = createQueryBuilder<IntrospectedSchema>({
  host: 'http://your-clickhouse-server:8123',
  username: 'default',
  password: 'your-password',
  database: 'default'
});
```

## Versioning and Release Channels

hypequery follows semantic versioning and provides multiple release channels:

- **Latest**: Stable releases (`npm install @hypequery/clickhouse`)
- **Beta**: Pre-release versions (`npm install @hypequery/clickhouse@beta`)

## Documentation

For detailed documentation and examples, visit our [documentation site](https://hypequery.com/docs).

- [Getting Started](https://hypequery.com/docs/installation)
- [Query Building](https://hypequery.com/docs/guides/query-building)
- [Filtering](https://hypequery.com/docs/guides/filtering)
- [Pagination](https://hypequery.com/docs/features/pagination)
- [API Reference](https://hypequery.com/docs/reference/api)


## Troubleshooting

### Common Issues

- **Connection Errors**: Ensure your ClickHouse server is running and accessible
- **CORS Issues**: Use a proxy server for browser environments
- **Type Errors**: Make sure to regenerate your schema types after schema changes
- **Client Not Found**: Make sure you have installed at least one of the required peer dependencies:
  - `@clickhouse/client` (for Node.js environments)
  - `@clickhouse/client-web` (for browser/universal environments)
- **Browser Bundler Issues**: Use manual injection to avoid bundler problems:
  ```typescript
  import { createClient } from '@clickhouse/client-web';
  const client = createClient({ host: 'your-host' });
  const db = createQueryBuilder({ host: 'your-host', client });
  ```
- **Browser Auto-Detection**: Auto-detection doesn't work in browsers because `require()` calls don't work. Use manual injection instead.

## Contributing

We welcome contributions! Please see our [contributing guide](CONTRIBUTING.md) for details.

## License

This project is licensed under the Apache-2.0 License - see the [LICENSE](LICENSE) file for details.

## Support

- 📚 [Documentation](https://hypequery.com/docs)
- 🐛 [Issue Tracker](https://github.com/hypequery/hypequery/issues)
- 💬 [Discussions](https://github.com/hypequery/hypequery/discussions)

---

<div align="center">
  <sub>Built with ❤️ by the hypequery team</sub>
</div> 
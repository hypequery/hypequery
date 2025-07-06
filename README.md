
<div align="center">
  <h1>@hypequery/clickhouse</h1>
  <p>A typescript-first library for building type-safe dashboards with ClickHouse</p>
  
  [![GitHub license](https://img.shields.io/github/license/hypequery/hypequery)](https://github.com/hypequery/hypequery/blob/main/LICENSE)
  [![npm version](https://badge.fury.io/js/@hypequery%2Fclickhouse.svg)](https://badge.fury.io/js/@hypequery%2Fclickhouse)
  [![GitHub stars](https://img.shields.io/github/stars/hypequery/hypequery)](https://github.com/hypequery/hypequery/stargazers)
</div>

> **Note:** This package is published on npm as `@hypequery/clickhouse`.

## Overview

hypequery is a typescript-first query builder for ClickHouse designed specifically for building real-time, type-safe analytics dashboards. Unlike generic SQL query builders, hypequery understands your ClickHouse schema and provides full type checking, making it ideal for data-intensive applications.

## Features

- 🎯 **Type-Safe**: Full TypeScript support with types from your ClickHouse schema
- 🚀 **Performant**: Built for real-time analytics with optimized query generation
- 🔍 **Cross Filtering**: Powerful cross-filtering capabilities for interactive dashboards
- 🛠️ **Developer Friendly**: Fluent API design for an intuitive development experience
- 📱 **Platform Agnostic**: Works in both Node.js and browser environments
- 🔄 **Schema Generation**: CLI tool to generate TypeScript types from your ClickHouse schema

## Installation

```bash
# npm
npm install @hypequery/clickhouse

# yarn
yarn add @hypequery/clickhouse

# pnpm
pnpm add @hypequery/clickhouse
```

## Quick Start

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

## Versioning and Release Channels

hypequery follows semantic versioning and provides multiple release channels:

- **Latest**: Stable releases (`npm install @hypequery/clickhouse`)
- **Beta**: Pre-release versions (`npm install @hypequery/clickhouse@beta`)

## Documentation

For detailed documentation and examples, visit our [documentation site](https://hypequery.com/docs).

- [Getting Started](https://hypequery.com/docs/installation)
- [Query Building](https://hypequery.com/docs/guides/query-building)
- [Filtering](https://hypequery.com/docs/guides/filtering)
- [API Reference](https://hypequery.com/docs/reference/api)

## Troubleshooting

### Common Issues

- **Connection Errors**: Ensure your ClickHouse server is running and accessible
- **CORS Issues**: Use a proxy server for browser environments
- **Type Errors**: Make sure to regenerate your schema types after schema changes


## License

This project is licensed under the Apache 2.0 License - see the [LICENSE](LICENSE) file for details.

## Support

- 📚 [Documentation](https://hypequery.com/docs)
- 🐛 [Issue Tracker](https://github.com/hypequery/hypequery/issues)
- 💬 [Discussions](https://github.com/hypequery/hypequery/discussions)


## Core Features

### Type-Safe Queries

hypequery provides full TypeScript support, ensuring your queries are type-safe:

```typescript
// Column names are type-checked
const query = db.table('trips')
  .select(['pickup_datetime', 'total_amount']) 
  .where('total_amount', 'gt', 50)
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
  .where('pickup_datetime', 'gte', '2024-01-01')
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

---

<div align="center">
  <sub>Built with ❤️ by the hypequery team</sub>
</div> 

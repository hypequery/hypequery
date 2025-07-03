# hypequery TypeScript Generator

This tool automatically generates TypeScript type definitions from your ClickHouse database schema.

## Installation

The TypeScript generator is included with the `@hypequery/clickhouse` package:

```bash
npm install @hypequery/clickhouse
```

## Quick Start

Generate TypeScript types for your ClickHouse database:

```bash
npx hypequery-generate-types
```

This will:
1. Connect to your ClickHouse database using environment variables
2. Introspect all tables in your database
3. Generate TypeScript definitions in `./generated-schema.ts`

## Example Usage

**Generate types with a custom output path:**

```bash
npx hypequery-generate-types ./src/types/db-schema.ts
```

**Specify database connection directly:**

```bash
CLICKHOUSE_HOST=http://clickhouse.example.com:8123 \
CLICKHOUSE_USER=myuser \
CLICKHOUSE_PASSWORD=mypassword \
CLICKHOUSE_DATABASE=analytics \
npx hypequery-generate-types
```

## Configuration

Configure the connection using environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `CLICKHOUSE_HOST` | ClickHouse server URL | `http://localhost:8123` |
| `CLICKHOUSE_USER` | ClickHouse username | `default` |
| `CLICKHOUSE_PASSWORD` | ClickHouse password | _(empty)_ |
| `CLICKHOUSE_DATABASE` | ClickHouse database name | `default` |

You can set these in:
- A `.env` file in your project root
- Your system environment
- Directly when running the command

## Using Generated Types

Import the generated types in your code:

```typescript
import { createQueryBuilder } from '@hypequery/clickhouse';
import { IntrospectedSchema } from './generated-schema';

// Create a type-safe query builder
const db = createQueryBuilder<IntrospectedSchema>({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

// Enjoy complete type safety!
const results = await db
  .table('users')          // TypeScript checks table exists
  .select(['id', 'name'])  // TypeScript checks columns exist
  .where('id', 'gt', 10)   // TypeScript validates types
  .execute();

// Results are properly typed
results.forEach(user => {
  console.log(user.name);  // TypeScript knows this is a string
});
```

## Adding to Your Workflow

Add it to your npm scripts:

```json
{
  "scripts": {
    "generate-types": "hypequery-generate-types ./src/types/db-schema.ts",
    "prebuild": "npm run generate-types",
    "build": "tsc"
  }
}
```

## Troubleshooting

If you encounter issues:

1. **Connection problems**
   - Make sure ClickHouse is running and accessible
   - Check your firewall settings

2. **Authentication failures**
   - Verify your username and password
   - Ensure the user has sufficient permissions

3. **Missing tables**
   - Confirm you're connecting to the correct database
   - Verify the tables exist in your ClickHouse instance

For more help, run:

```bash
npx hypequery-generate-types --help
``` 
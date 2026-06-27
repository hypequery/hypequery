# @hypequery/mcp

Model Context Protocol (MCP) server for Hypequery semantic layer. Exposes datasets and metrics to AI agents like Claude Desktop, Cursor, and other MCP-compatible tools.

## Features

- **MCP Tools**: List datasets, introspect schemas, query metrics and datasets
- **Natural Language**: AI-friendly prompts and responses
- **Type-Safe**: Full TypeScript support with the Hypequery semantic layer
- **ClickHouse Native**: Optimized for ClickHouse analytics workloads

## Installation

```bash
npm install @hypequery/mcp
# or
pnpm add @hypequery/mcp
```

## Quick Start

### 1. Create an MCP Config File

Create `mcp-config.ts`:

```typescript
import { createDatasetClient } from '@hypequery/datasets';
import { createQueryBuilder } from '@hypequery/clickhouse';
import { OrdersDataset, CustomersDataset } from './datasets/index.js';

const revenue = OrdersDataset.metric('revenue', { measure: 'revenue' });
const customerCount = CustomersDataset.metric('customerCount', {
  measure: 'customerCount',
});

// Export your datasets
export const datasets = {
  orders: {
    ...OrdersDataset,
    metrics: { revenue },
  },
  customers: {
    ...CustomersDataset,
    metrics: { customerCount },
  },
};

// Export the semantic runner consumed by the MCP server
const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

export const analytics = createDatasetClient({ queryBuilder: db });
```

### 2. Run the MCP Server

```bash
npx hypequery-mcp --config ./mcp-config.js
```

### 3. Configure Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "hypequery": {
      "command": "npx",
      "args": ["hypequery-mcp", "--config", "/absolute/path/to/mcp-config.js"]
    }
  }
}
```

### 4. Use with Claude

Now you can ask Claude to query your data:

> "Show me revenue by region for the last month"

> "What are the top 10 customers by order count?"

> "List all available datasets"

## Available Tools

### `list_datasets`

Lists all available datasets with their descriptions.

**Example:**
```typescript
{
  "name": "list_datasets"
}
```

**Response:**
```json
{
  "datasets": [
    {
      "name": "orders",
      "description": "Customer orders and revenue data",
      "dimensionCount": 5,
      "measureCount": 4,
      "metricCount": 4
    }
  ],
  "total": 1
}
```

### `get_dataset_schema`

Gets the complete schema for a dataset.

**Example:**
```typescript
{
  "name": "get_dataset_schema",
  "arguments": {
    "dataset": "orders"
  }
}
```

**Response:**
```json
{
  "name": "orders",
  "dimensions": {
    "region": { "type": "string", "label": "Region" },
    "status": { "type": "string", "label": "Order Status" }
  },
  "measures": {
    "revenue": { "aggregation": "sum", "field": "amount", "label": "Revenue" },
    "orderCount": { "aggregation": "count", "field": "id", "label": "Order Count" }
  },
  "metrics": {
    "totalRevenue": { "type": "metric", "aggregation": "revenue", "label": "Total Revenue" }
  }
}
```

### `query_metric`

Executes a pre-defined metric query.

**Example:**
```typescript
{
  "name": "query_metric",
  "arguments": {
    "dataset": "orders",
    "metric": "revenue",
    "dimensions": ["region"],
    "filters": [
      { "field": "status", "operator": "eq", "value": "completed" }
    ],
    "grain": "month",
    "orderBy": [
      { "field": "revenue", "direction": "desc" }
    ],
    "limit": 10
  }
}
```

**Response:**
```json
{
  "data": [
    { "region": "US", "month": "2024-01", "revenue": 125000 },
    { "region": "EU", "month": "2024-01", "revenue": 98000 }
  ],
  "meta": {
    "sql": "SELECT...",
    "timingMs": 45,
    "rowCount": 2
  }
}
```

### `query_dataset`

Executes an ad-hoc dataset query with custom dimensions and measures. The older `metrics` argument is still accepted as a compatibility alias for `measures`.

**Example:**
```typescript
{
  "name": "query_dataset",
  "arguments": {
    "dataset": "orders",
    "dimensions": ["region", "status"],
    "measures": ["revenue", "orderCount"],
    "limit": 100
  }
}
```

## Programmatic Usage

You can also use the MCP server programmatically in your application:

```typescript
import { createMCPServer } from '@hypequery/mcp';
import { createDatasetClient } from '@hypequery/datasets';
import { datasets } from './datasets/index.js';

const analytics = createDatasetClient({
  url: process.env.CLICKHOUSE_URL,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE,
});

const server = await createMCPServer({
  datasets,
  analytics,
  name: 'my-analytics-mcp',
  version: '1.0.0',
});

// Server is now running via stdio transport
```

## Filter Operators

- `eq`: Equal to
- `neq`: Not equal to
- `gt`: Greater than
- `gte`: Greater than or equal to
- `lt`: Less than
- `lte`: Less than or equal to
- `in`: In list
- `notIn`: Not in list
- `between`: Between two values
- `like`: Pattern match (SQL LIKE)

## Time Grains

- `day`: Daily aggregation
- `week`: Weekly aggregation
- `month`: Monthly aggregation
- `quarter`: Quarterly aggregation
- `year`: Yearly aggregation

## Prompts

The MCP server also exposes a `dataset_guide` prompt that provides natural language guidance for querying datasets.

## Environment Variables

Your config file can use environment variables for database credentials:

```typescript
const analytics = createDatasetClient({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});
```

## Troubleshooting

### MCP server not connecting

1. Check that the config file path is absolute, not relative
2. Ensure the config file exports both `datasets` and `analytics`
3. Check Claude Desktop logs for errors

### Queries failing

1. Verify your ClickHouse connection is working
2. Check that dataset definitions match your database schema
3. Use the `meta.sql` field in responses to debug generated SQL

## Related Packages

- `@hypequery/datasets` - Semantic layer DSL
- `@hypequery/clickhouse` - ClickHouse query builder
- `@hypequery/serve` - HTTP server for analytics endpoints

## License

Apache-2.0

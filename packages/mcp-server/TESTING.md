# Testing the Hypequery MCP Server

This guide walks you through testing the MCP server with Claude Desktop.

## Prerequisites

1. **Claude Desktop** - Download from [claude.ai/download](https://claude.ai/download)
2. **ClickHouse** - Running instance with sample data
3. **Node.js** - v18+ with ESM support

## Quick Start (5 minutes)

### Step 1: Build the MCP Server

```bash
cd packages/mcp-server
pnpm install
pnpm build
```

Verify the build:
```bash
ls dist/
# Should see: bin.js, server.js, tools/, prompts/, etc.
```

### Step 2: Create Your MCP Config

Copy the example config:
```bash
cp examples/mcp-config.js ./my-mcp-config.js
```

Edit `my-mcp-config.js` to match your ClickHouse schema:
```javascript
import { dataset, dimension, measure } from '@hypequery/datasets';
import { createDatasetClient } from '@hypequery/clickhouse/datasets';

const executor = createDatasetClient({
  host: 'localhost',
  username: 'default',
  password: '',
  database: 'analytics',
});

// Define your datasets based on your actual tables
const MyDataset = dataset('my_table', {
  source: 'my_table',
  dimensions: {
    id: dimension.number(),
  },
  measures: {
    rowCount: measure.count('id'),
  },
});

const rowCount = MyDataset.metric('rowCount', { measure: 'rowCount' });

export const datasets = {
  my_table: {
    ...MyDataset,
    metrics: { rowCount },
  },
};
export { executor };
```

### Step 3: Test the MCP Server Standalone

Before connecting to Claude Desktop, test the server directly:

```bash
# Set environment variables
export CLICKHOUSE_HOST=localhost
export CLICKHOUSE_USER=default
export CLICKHOUSE_PASSWORD=your-password
export CLICKHOUSE_DATABASE=analytics

# Start the MCP server
node dist/bin.js --config ./my-mcp-config.js
```

The server should start and log:
```
Hypequery MCP Server started
```

**Note:** The server communicates via stdio (standard input/output), so you won't see a typical HTTP server message. Press Ctrl+C to stop.

### Step 4: Configure Claude Desktop

Find your Claude Desktop config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Create or edit the file:
```json
{
  "mcpServers": {
    "hypequery": {
      "command": "node",
      "args": [
        "/absolute/path/to/hypequery-core/packages/mcp-server/dist/bin.js",
        "--config",
        "/absolute/path/to/hypequery-core/packages/mcp-server/my-mcp-config.js"
      ],
      "env": {
        "CLICKHOUSE_HOST": "localhost",
        "CLICKHOUSE_USER": "default",
        "CLICKHOUSE_PASSWORD": "your-password",
        "CLICKHOUSE_DATABASE": "analytics"
      }
    }
  }
}
```

**Important:** Use absolute paths, not relative paths!

To get absolute paths:
```bash
cd packages/mcp-server
pwd
# Copy this path and append /dist/bin.js and /my-mcp-config.js
```

### Step 5: Restart Claude Desktop

1. Quit Claude Desktop completely
2. Relaunch Claude Desktop
3. Look for the MCP server icon/indicator in the UI

### Step 6: Test with Claude

Start a new conversation and try these queries:

#### Test 1: List Datasets
```
List all available datasets
```

Expected response:
```json
{
  "datasets": [
    {
      "name": "orders",
      "description": "...",
      "dimensionCount": 5,
      "metricCount": 3
    }
  ],
  "total": 1
}
```

#### Test 2: Get Schema
```
Show me the schema for the orders dataset
```

Expected response: JSON with dimensions, metrics, relationships

#### Test 3: Query Metric
```
What is the total revenue for orders?
```

Claude should use the `query_metric` tool and return actual data from your ClickHouse.

#### Test 4: Query with Filters
```
Show me revenue by region where status = 'completed'
```

#### Test 5: Time-Series Query
```
Show me daily revenue for the last 30 days
```

## Troubleshooting

### MCP Server Not Connecting

**Check Claude Desktop Logs:**
- macOS: `~/Library/Logs/Claude/mcp*.log`
- Windows: `%LOCALAPPDATA%/Claude/logs/mcp*.log`

**Common Issues:**

1. **"Module not found"**
   - Make sure you ran `pnpm install` in `packages/mcp-server`
   - Check that `node_modules` exists and has dependencies

2. **"Cannot find module '@hypequery/datasets'"**
   - The MCP server needs access to the datasets package
   - Make sure you're in a monorepo with workspace linking

3. **"ECONNREFUSED" when querying**
   - ClickHouse is not running
   - Check connection credentials in config

4. **Server starts but Claude can't see it**
   - Check absolute paths in `claude_desktop_config.json`
   - Restart Claude Desktop completely (not just close window)
   - Check that config JSON is valid (no trailing commas)

### Debug Mode

Add debug logging to your config:
```javascript
console.error('MCP Config loaded');
console.error('Datasets:', Object.keys(datasets));
console.error('ClickHouse connected');
```

Logs go to stderr (won't interfere with MCP protocol on stdout).

### Verify MCP Server is Running

In Claude Desktop, look for:
- MCP server indicator in the UI
- Tool suggestions when you ask data questions
- Or ask Claude: "What tools do you have access to?"

## Example Queries to Try

Once connected, try these progressively complex queries:

### Basic Queries
```
1. List all datasets
2. What dimensions are in the orders dataset?
3. How many orders are there in total?
```

### Filtered Queries
```
4. Show me orders where status = 'completed'
5. What's the revenue for region = 'US'?
6. Show me top 10 customers by order count
```

### Time-Series Queries
```
7. Show me daily revenue for the last 7 days
8. What's the monthly revenue trend this year?
9. Compare weekly orders: this week vs last week
```

### Multi-Dimensional Queries
```
10. Show me revenue by region and status
11. What's the average order value by customer segment?
12. Show me order count by day of week
```

### Complex Queries
```
13. Show me top 5 regions by revenue, filtered to completed orders only
14. What's the month-over-month revenue growth?
15. Show me orders grouped by region, sorted by revenue descending, limit 20
```

## Expected Performance

- **list_datasets**: < 10ms
- **get_dataset_schema**: < 10ms
- **query_metric** (simple): 50-200ms (depends on ClickHouse)
- **query_metric** (complex): 100-500ms

If queries take > 1 second, check:
- ClickHouse query performance
- Network latency
- Table size and indexes

## Next Steps

Once basic testing works:

1. **Add Real Datasets** - Replace example config with your actual schema
2. **Test Edge Cases** - Try nullable fields, enums, date ranges
3. **Test Multi-Tenancy** - If using `tenantKey`, verify isolation
4. **Test Relationships** - Add related datasets (note: joins not yet implemented)
5. **Performance Test** - Query large tables, check timing

## Getting Help

If you encounter issues:

1. Check the logs (stderr output)
2. Verify ClickHouse connection with a simple query
3. Test the MCP server standalone before connecting to Claude
4. Check Claude Desktop logs for MCP errors

## Example MCP Config for Testing

Minimal working example:

```javascript
import { dataset, dimension, measure } from '@hypequery/datasets';
import { createDatasetClient } from '@hypequery/clickhouse/datasets';

const executor = createDatasetClient({
  host: 'localhost',
  username: 'default',
  password: '',
  database: 'default',
});

const TestDataset = dataset('system.numbers', {
  source: 'system.numbers',
  dimensions: {
    number: dimension.number({ label: 'Number' }),
  },
  measures: {
    count: measure.count('number', { label: 'Count' }),
    sum: measure.sum('number', { label: 'Sum' }),
  },
});

const count = TestDataset.metric('count', { measure: 'count' });
const sum = TestDataset.metric('sum', { measure: 'sum' });

export const datasets = {
  numbers: {
    ...TestDataset,
    metrics: { count, sum },
  },
};
export { executor };
```

This uses ClickHouse's built-in `system.numbers` table, so no setup needed!

Test query: "Show me the sum of numbers limit 10"

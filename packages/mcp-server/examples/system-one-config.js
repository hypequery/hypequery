/**
 * Minimal MCP Config for Instant Testing
 *
 * Uses ClickHouse's finite system.one table - no setup required.
 * Perfect for checking that the MCP server can load a valid dataset and run a
 * simple query without creating any tables.
 *
 * Usage:
 *   node dist/bin.js --config examples/system-one-config.js
 */

import { createDatasetClient, dataset, dimension, measure } from '@hypequery/datasets';
import { createQueryBuilder } from '@hypequery/clickhouse';

// Connect to local ClickHouse (defaults)
const db = createQueryBuilder({
  url: process.env.CLICKHOUSE_URL || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default',
});

const analytics = createDatasetClient({ queryBuilder: db });

// Define a dataset over ClickHouse's built-in, single-row system.one table.
const SystemOneDataset = dataset('system_one', {
  source: 'system.one',
  limits: { maxResultSize: 1 },
  dimensions: {
    dummy: dimension.number({ label: 'Dummy Value' }),
  },
  measures: {
    rowCount: measure.count('dummy', { label: 'Row Count' }),
  },
});

const rowCount = SystemOneDataset.metric('rowCount', { measure: 'rowCount' });

// Export for MCP server
export const datasets = {
  one: {
    ...SystemOneDataset,
    metrics: { rowCount },
  },
};

export { analytics };

/**
 * Test queries to try with Claude:
 *
 * 1. "List all datasets"
 * 2. "Show me the schema for the one dataset"
 * 3. "How many rows are in the one dataset?" (should be 1)
 */

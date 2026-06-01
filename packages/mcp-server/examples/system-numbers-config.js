/**
 * Minimal MCP Config for Instant Testing
 *
 * Uses ClickHouse's built-in system.numbers table - no setup required!
 * Perfect for testing the MCP server without creating any tables.
 *
 * Usage:
 *   node dist/bin.js --config examples/system-numbers-config.js
 */

import { dataset, dimension, measure } from '@hypequery/datasets';
import { createDatasetClient } from '@hypequery/clickhouse/datasets';

// Connect to local ClickHouse (defaults)
const executor = createDatasetClient({
  host: process.env.CLICKHOUSE_HOST || 'localhost',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default',
});

// Define a dataset over system.numbers (built-in ClickHouse table)
const NumbersDataset = dataset('system_numbers', {
  source: 'system.numbers',
  dimensions: {
    number: dimension.number({ label: 'Number' }),
  },
  measures: {
    count: measure.count('number', { label: 'Row Count' }),
    sum: measure.sum('number', { label: 'Sum of Numbers' }),
    avg: measure.avg('number', { label: 'Average Number' }),
    max: measure.max('number', { label: 'Max Number' }),
  },
});

const count = NumbersDataset.metric('count', { measure: 'count' });
const sum = NumbersDataset.metric('sum', { measure: 'sum' });
const avg = NumbersDataset.metric('avg', { measure: 'avg' });
const max = NumbersDataset.metric('max', { measure: 'max' });

// Export for MCP server
export const datasets = {
  numbers: {
    ...NumbersDataset,
    metrics: { count, sum, avg, max },
  },
};

export { executor };

/**
 * Test queries to try with Claude:
 *
 * 1. "List all datasets"
 * 2. "Show me the schema for the numbers dataset"
 * 3. "What is the sum of the first 100 numbers?" (should be 4950)
 * 4. "Count the first 50 numbers" (should be 50)
 * 5. "What's the average of numbers from 1 to 10?" (should be 5.5)
 */

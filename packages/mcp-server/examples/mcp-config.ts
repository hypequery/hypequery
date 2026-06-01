/**
 * Example MCP Server Configuration
 *
 * This file shows how to configure the Hypequery MCP server for use with
 * Claude Desktop, Cursor, or other MCP-compatible tools.
 *
 * Setup:
 * 1. Copy this file to your project root
 * 2. Update the ClickHouse connection details
 * 3. Define your datasets
 * 4. Add to Claude Desktop config (see README)
 */

import { dataset, dimension, measure } from '@hypequery/datasets';
import { MetricExecutor } from '@hypequery/datasets';
import { createQueryBuilder } from '@hypequery/clickhouse';

// =============================================================================
// STEP 1: Configure ClickHouse Connection
// =============================================================================

const builderFactory = createQueryBuilder({
  host: process.env.CLICKHOUSE_HOST || 'localhost',
  port: process.env.CLICKHOUSE_PORT ? parseInt(process.env.CLICKHOUSE_PORT) : 8123,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

// =============================================================================
// STEP 2: Define Your Datasets
// =============================================================================

/**
 * Example: Orders Dataset
 */
export const OrdersDataset = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  tenantKey: 'tenant_id', // Optional: for multi-tenant setups
  dimensions: {
    orderId: dimension.number({ column: 'id', label: 'Order ID' }),
    userId: dimension.number({ column: 'user_id', label: 'User ID' }),
    status: dimension.string({ label: 'Order Status' }),
    region: dimension.string({ label: 'Region' }),
    createdAt: dimension.timestamp({ column: 'created_at', label: 'Created At' }),
  },
  measures: {
    totalOrders: measure.count('id', { label: 'Total Orders' }),
    totalRevenue: measure.sum('amount', { label: 'Total Revenue' }),
    avgOrderValue: measure.avg('amount', { label: 'Average Order Value' }),
  },
});

/**
 * Example: Customers Dataset
 */
export const CustomersDataset = dataset('customers', {
  source: 'customers',
  timeKey: 'created_at',
  dimensions: {
    customerId: dimension.number({ column: 'id', label: 'Customer ID' }),
    email: dimension.string({ label: 'Email' }),
    name: dimension.string({ label: 'Name' }),
    segment: dimension.string({ label: 'Customer Segment' }),
    createdAt: dimension.timestamp({ column: 'created_at', label: 'Created At' }),
  },
  measures: {
    totalCustomers: measure.count('id', { label: 'Total Customers' }),
    activeCustomers: measure.countDistinct('id', { label: 'Active Customers' }),
  },
});

// =============================================================================
// STEP 3: Export Datasets and Executor for MCP Server
// =============================================================================

/**
 * Export all datasets as a registry
 * The MCP server will expose these to AI agents
 */
const totalRevenue = OrdersDataset.metric('totalRevenue', { measure: 'totalRevenue' });
const totalOrders = OrdersDataset.metric('totalOrders', { measure: 'totalOrders' });
const totalCustomers = CustomersDataset.metric('totalCustomers', { measure: 'totalCustomers' });

export const datasets = {
  orders: {
    ...OrdersDataset,
    metrics: { totalRevenue, totalOrders },
  },
  customers: {
    ...CustomersDataset,
    metrics: { totalCustomers },
  },
};

/**
 * Create and export the metric executor
 * This handles query execution against ClickHouse
 */
export const executor = new MetricExecutor({ builderFactory });

// =============================================================================
// STEP 4: Claude Desktop Configuration
// =============================================================================

/**
 * Add this to your Claude Desktop config file:
 *
 * macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
 * Windows: %APPDATA%/Claude/claude_desktop_config.json
 *
 * {
 *   "mcpServers": {
 *     "hypequery": {
 *       "command": "node",
 *       "args": [
 *         "/absolute/path/to/node_modules/@hypequery/mcp/dist/bin.js",
 *         "--config",
 *         "/absolute/path/to/mcp-config.js"
 *       ],
 *       "env": {
 *         "CLICKHOUSE_HOST": "localhost",
 *         "CLICKHOUSE_USER": "default",
 *         "CLICKHOUSE_PASSWORD": "your-password",
 *         "CLICKHOUSE_DATABASE": "analytics"
 *       }
 *     }
 *   }
 * }
 */

// =============================================================================
// STEP 5: Example Queries
// =============================================================================

/**
 * Once configured, you can ask Claude:
 *
 * 1. "List all available datasets"
 *    → Uses list_datasets tool
 *
 * 2. "Show me the schema for the orders dataset"
 *    → Uses get_dataset_schema tool
 *
 * 3. "What was the total revenue by region last month?"
 *    → Uses query_metric tool with filters and dimensions
 *
 * 4. "Show me top 10 customers by order count"
 *    → Uses query_dataset tool with sorting and limits
 *
 * 5. "Compare revenue month-over-month for Q1"
 *    → Uses query_metric with time grain
 */

/**
 * Example MCP Server Configuration (JavaScript)
 *
 * This is a simple JavaScript example that can be used directly without TypeScript.
 * Copy this file and modify it for your ClickHouse schema.
 */

import { dataset, dimension, measure, MetricExecutor } from '@hypequery/datasets';
import { createQueryBuilder } from '@hypequery/clickhouse';

// =============================================================================
// ClickHouse Connection
// =============================================================================

const builderFactory = createQueryBuilder({
  host: process.env.CLICKHOUSE_HOST || 'localhost',
  port: process.env.CLICKHOUSE_PORT ? parseInt(process.env.CLICKHOUSE_PORT) : 8123,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

// =============================================================================
// Dataset Definitions
// =============================================================================

const OrdersDataset = dataset('orders', {
  source: 'orders',
  timeKey: 'created_at',
  dimensions: {
    orderId: dimension.number({ column: 'id', label: 'Order ID' }),
    status: dimension.string({ label: 'Status' }),
    region: dimension.string({ label: 'Region' }),
    createdAt: dimension.timestamp({ column: 'created_at', label: 'Created At' }),
  },
  measures: {
    totalOrders: measure.count('id', { label: 'Total Orders' }),
    revenue: measure.sum('amount', { label: 'Revenue' }),
    avgOrderValue: measure.avg('amount', { label: 'Avg Order Value' }),
  },
});

// =============================================================================
// Exports for MCP Server
// =============================================================================

const totalRevenue = OrdersDataset.metric('totalRevenue', { measure: 'totalRevenue' });
const totalOrders = OrdersDataset.metric('totalOrders', { measure: 'totalOrders' });

export const datasets = {
  orders: {
    ...OrdersDataset,
    metrics: { totalRevenue, totalOrders },
  },
};

export const executor = new MetricExecutor({ builderFactory });

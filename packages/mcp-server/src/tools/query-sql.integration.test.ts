import { describe, expect, it, vi } from 'vitest';
import {
  createDatasetClient,
  dataset,
  dimension,
  measure,
  eq,
  desc,
  type QueryBuilderFactoryLike,
  type QueryBuilderLike,
} from '@hypequery/datasets';
import { queryDatasetTool } from './query-dataset.js';
import { queryMetricTool } from './query-metric.js';

type BuilderColumnsInput = string[] | string;

const Orders = dataset('orders', {
  source: 'orders',
  tenantKey: 'tenant_id',
  timeKey: 'created_at',
  dimensions: {
    id: dimension.string(),
    tenantId: dimension.string({ column: 'tenant_id' }),
    country: dimension.string({ column: 'country_code' }),
    status: dimension.string(),
    amount: dimension.number(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    orderCount: measure.count('id'),
    completedRevenue: measure.sum('amount', {
      filters: [eq('status', 'completed')],
    }),
  },
});

const totalRevenue = Orders.metric('totalRevenue', { measure: 'revenue' });

function createSqlBuilderFactory(mockData: Record<string, unknown>[] = []): QueryBuilderFactoryLike {
  function createBuilder(source: string): QueryBuilderLike {
    const state = {
      select: [] as string[],
      where: [] as string[],
      groupBy: [] as string[],
      orderBy: [] as string[],
      limit: undefined as number | undefined,
      offset: undefined as number | undefined,
    };

    const buildSql = () => [
      `SELECT ${state.select.join(', ')} FROM ${source}`,
      state.where.length > 0 ? `WHERE ${state.where.join(' AND ')}` : '',
      state.groupBy.length > 0 ? `GROUP BY ${state.groupBy.join(', ')}` : '',
      state.orderBy.length > 0 ? `ORDER BY ${state.orderBy.join(', ')}` : '',
      state.limit != null ? `LIMIT ${state.limit}` : '',
      state.offset != null ? `OFFSET ${state.offset}` : '',
    ].filter(Boolean).join(' ');

    const builder: QueryBuilderLike = {
      select: (args: BuilderColumnsInput) => {
        state.select.push(...(Array.isArray(args) ? args : [args]));
        return builder;
      },
      sum: (column: string, alias?: string) => {
        state.select.push(`SUM(${column}) AS ${alias ?? `${column}_sum`}`);
        return builder;
      },
      count: (column: string, alias?: string) => {
        state.select.push(`COUNT(${column}) AS ${alias ?? `${column}_count`}`);
        return builder;
      },
      countDistinct: (column: string, alias?: string) => {
        state.select.push(`COUNT(DISTINCT ${column}) AS ${alias ?? `${column}_countDistinct`}`);
        return builder;
      },
      avg: (column: string, alias?: string) => {
        state.select.push(`AVG(${column}) AS ${alias ?? `${column}_avg`}`);
        return builder;
      },
      min: (column: string, alias?: string) => {
        state.select.push(`MIN(${column}) AS ${alias ?? `${column}_min`}`);
        return builder;
      },
      max: (column: string, alias?: string) => {
        state.select.push(`MAX(${column}) AS ${alias ?? `${column}_max`}`);
        return builder;
      },
      where: (column: string, operator: string, _value: unknown) => {
        state.where.push(`${column} ${operator === 'eq' ? '=' : operator} ?`);
        return builder;
      },
      groupBy: (args: BuilderColumnsInput) => {
        state.groupBy.push(...(Array.isArray(args) ? args : [args]));
        return builder;
      },
      orderBy: (column: string, direction?: string) => {
        state.orderBy.push(`${column} ${direction ?? 'ASC'}`);
        return builder;
      },
      limit: (count: number) => {
        state.limit = count;
        return builder;
      },
      offset: (count: number) => {
        state.offset = count;
        return builder;
      },
      toSQLWithParams: () => ({ sql: buildSql(), parameters: [] }),
      execute: vi.fn().mockResolvedValue(mockData),
    };

    return builder;
  }

  return {
    table: createBuilder,
    rawQuery: vi.fn().mockResolvedValue(mockData),
  };
}

function parseToolResponse(result: Awaited<ReturnType<typeof queryDatasetTool>>) {
  return JSON.parse(result.content[0].text) as {
    data: Record<string, unknown>[];
    meta: { sql?: string; rowCount: number; timingMs?: number };
  };
}

describe('MCP query tools SQL integration', () => {
  it('returns dataset SQL with tenant scoping, grain, filtered measures, limit, and offset', async () => {
    const analytics = createDatasetClient({
      queryBuilder: createSqlBuilderFactory([{ period: '2026-01-01', country: 'US', completedRevenue: 100 }]),
    });

    const result = await queryDatasetTool({ orders: Orders as any }, analytics, {
      dataset: 'orders',
      dimensions: ['country'],
      metrics: ['completedRevenue'],
      grain: 'month',
      filters: [eq('status', 'completed')],
      orderBy: [desc('completedRevenue')],
      limit: 25,
      offset: 5,
      tenant: 'tenant-1',
    });

    const response = parseToolResponse(result);
    expect(response.meta.sql).toContain('toStartOfMonth(created_at) AS period');
    expect(response.meta.sql).toContain("SUM(if((status = 'completed'), amount, 0)) AS completedRevenue");
    expect(response.meta.sql).toContain('WHERE tenant_id = ? AND status = ?');
    expect(response.meta.sql).toContain('ORDER BY completedRevenue DESC');
    expect(response.meta.sql).toContain('LIMIT 25 OFFSET 5');
    expect(response.meta.rowCount).toBe(1);
  });

  it('returns metric SQL with tenant scoping from tenantId alias', async () => {
    const analytics = createDatasetClient({
      queryBuilder: createSqlBuilderFactory([{ country: 'US', totalRevenue: 100 }]),
    });
    const registry = {
      orders: Object.assign(Orders, { totalRevenue }) as any,
    };

    const result = await queryMetricTool(registry, analytics, {
      dataset: 'orders',
      metric: 'totalRevenue',
      dimensions: ['country'],
      tenantId: 'tenant-1',
    });

    const response = JSON.parse(result.content[0].text) as {
      meta: { sql?: string; rowCount: number };
    };
    expect(response.meta.sql).toContain('SELECT country_code AS country, SUM(amount) AS totalRevenue FROM orders');
    expect(response.meta.sql).toContain('WHERE tenant_id = ?');
    expect(response.meta.sql).toContain('GROUP BY country');
  });

  it('rejects explicit tenant filters when MCP tenant scoping is active', async () => {
    const analytics = createDatasetClient({ queryBuilder: createSqlBuilderFactory() });

    await expect(queryDatasetTool({ orders: Orders as any }, analytics, {
      dataset: 'orders',
      metrics: ['revenue'],
      filters: [eq('tenantId', 'tenant-1')],
      tenant: 'tenant-1',
    })).rejects.toThrow('Cannot filter on tenant field "tenantId"');
  });

  it('rejects malformed MCP query arguments before execution', async () => {
    const analytics = createDatasetClient({ queryBuilder: createSqlBuilderFactory() });

    await expect(queryDatasetTool({ orders: Orders as any }, analytics, {
      dataset: 'orders',
      dimensions: 'country',
    })).rejects.toThrow('Invalid query_dataset arguments');

    await expect(queryMetricTool({ orders: Object.assign(Orders, { totalRevenue }) as any }, analytics, {
      dataset: 'orders',
      metric: 'totalRevenue',
      limit: -1,
    })).rejects.toThrow('Invalid query_metric arguments');
  });
});

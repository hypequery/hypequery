import { describe, expect, it } from 'vitest';
import { createDatasetClient, dataset, dimension, measure } from '@hypequery/datasets';
import { createQueryBuilder } from '@hypequery/clickhouse';
import { HypequeryMCPExecutor } from '../executor.js';
import { createMCPDiscoveryExecutor } from '../discovery-executor.js';

const Orders = dataset('orders', {
  source: 'orders',
  dimensions: {
    customerId: dimension.string({ column: 'customer_id' }),
    amount: dimension.number(),
  },
  measures: {
    revenue: measure.sum('amount'),
    orders: measure.count('customerId'),
  },
});

function recordingExecutor() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = createQueryBuilder({
    adapter: {
      name: 'recording',
      async query<T>(sql: string, params: unknown[] = []) {
        calls.push({ sql, params });
        return [] as T[];
      },
    },
  });
  const executor = new HypequeryMCPExecutor({
    datasets: { orders: Orders },
    analytics: createDatasetClient({ queryBuilder: db }),
  });
  return { executor, calls };
}

const queryDatasetSchema = async (executor: { listTools(): Promise<{ tools: { name: string; inputSchema: unknown }[] }> }) => {
  const { tools } = await executor.listTools();
  return JSON.stringify(tools.find(tool => tool.name === 'query_dataset')?.inputSchema);
};

describe('query_dataset having', () => {
  it('advertises having identically on local and hosted discovery surfaces (CORE-03)', async () => {
    const local = await queryDatasetSchema(recordingExecutor().executor);
    const hosted = await queryDatasetSchema(createMCPDiscoveryExecutor({ datasets: { orders: Orders } }));
    expect(local).toContain('"having"');
    expect(hosted).toBe(local);
  });

  it('executes having conditions as bound parameters after grouping', async () => {
    const { executor, calls } = recordingExecutor();
    const response = await executor.callTool('query_dataset', {
      dataset: 'orders',
      dimensions: ['customerId'],
      measures: ['revenue'],
      having: [{ measure: 'revenue', operator: 'gt', value: 1000 }],
    });

    expect(response.isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('FROM base WHERE `revenue` > ?');
    expect(calls[0].params).toEqual([1000]);
  });

  it.each([
    ['an unsupported operator', { measure: 'revenue', operator: 'inSubquery', value: 'SELECT 1' }],
    ['a string value', { measure: 'revenue', operator: 'gt', value: '1 OR 1=1' }],
    ['a dimension', { measure: 'customerId', operator: 'gt', value: 1 }],
    ['an unselected measure', { measure: 'orders', operator: 'gt', value: 1 }],
  ])('rejects %s without querying', async (_label, condition) => {
    const { executor, calls } = recordingExecutor();
    const response = await executor.callTool('query_dataset', {
      dataset: 'orders',
      measures: ['revenue'],
      having: [condition],
    });

    expect(response.isError).toBe(true);
    expect(calls).toEqual([]);
  });
});

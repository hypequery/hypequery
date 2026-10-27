/**
 * The surfaces above datasets — serve's HTTP API and the MCP tools — running
 * on a live Postgres through @hypequery/postgres, with nothing engine-specific
 * in their own code.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatasetClient, dataset, dimension, measure } from '@hypequery/datasets';
import { createMCPExecutor } from '@hypequery/mcp';
import { createAPI } from '@hypequery/serve';
import { createPostgresQueryBuilder } from '../../index.js';

const url = process.env.POSTGRES_URL;
const SCHEMA = 'hq_surfaces';

const Orders = dataset('orders', {
  source: `${SCHEMA}.orders`,
  timeKey: 'createdAt',
  dimensions: {
    createdAt: dimension.timestamp({ column: 'created_at' }),
    status: dimension.string(),
    amount: dimension.number({ groupable: false }),
  },
  measures: { revenue: measure.sum('amount'), orders: measure.count('status') },
  filters: { status: { __type: 'filter_definition', field: 'status', operators: ['eq', 'in'] } },
});

describe.skipIf(!url)('serve and MCP on Postgres', () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 });
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    await pool.query(`CREATE TABLE ${SCHEMA}.orders (status text, amount bigint, created_at timestamptz)`);
    await pool.query(`INSERT INTO ${SCHEMA}.orders VALUES
      ('paid', 100, '2026-01-01T10:00Z'), ('paid', 250, '2026-01-02T10:00Z'), ('refunded', 70, '2026-01-02T12:00Z')`);
  });
  afterAll(async () => {
    await pool?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool?.end();
  });

  it('serves dataset queries and the semantic contract over HTTP', async () => {
    const api = createAPI({ datasets: { orders: Orders }, queryBuilder: createPostgresQueryBuilder({ pool }) });
    const response = await api.handler({
      method: 'POST',
      path: '/api/analytics/datasets/orders/query',
      headers: { 'content-type': 'application/json' },
      query: {},
      body: { dimensions: ['status'], measures: ['revenue', 'orders'], orderBy: [{ field: 'status', direction: 'asc' }] },
    });
    expect(response.status).toBe(200);
    expect((response.body as { data: unknown[] }).data).toEqual([
      { status: 'paid', revenue: '350', orders: '2' },
      { status: 'refunded', revenue: '70', orders: '1' },
    ]);
    const contract = await api.handler({ method: 'GET', path: '/api/analytics/contract', headers: {}, query: {} });
    expect(contract.status).toBe(200);
  });

  it('answers MCP dataset tools', async () => {
    const executor = createMCPExecutor({
      datasets: { orders: Orders },
      analytics: createDatasetClient({ queryBuilder: createPostgresQueryBuilder({ pool }) }),
    });
    const tools = (await executor.listTools()).tools.map(tool => tool.name);
    expect(tools).toContain('query_dataset');
    const result = await executor.callTool('query_dataset', {
      dataset: 'orders', measures: ['revenue'], grain: 'day', timezone: 'America/New_York',
    });
    expect(result.isError).toBeFalsy();
    const [content] = result.content as { type: string; text: string }[];
    expect(JSON.parse(content!.text).data).toEqual([
      { period: '2026-01-01 00:00:00', revenue: '100' },
      { period: '2026-01-02 00:00:00', revenue: '320' },
    ]);
  });
});

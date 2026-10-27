import { describe, expect, it, vi } from 'vitest';
import { checkDatasets, type CheckableDataset, type CompileQuery } from './run-check.js';

const statement = (sql: string) => ({ sql, parameters: [], preflightStatements: [] });

const orders: CheckableDataset = {
  timeKey: 'created_at',
  dimensions: { status: {}, created_at: {} },
  measures: { revenue: {}, trailing: {}, broken: {} },
  relationships: {
    customer: { kind: 'belongsTo', target: () => ({ dimensions: { country: {} } }) },
    lines: { kind: 'hasMany', target: () => ({ dimensions: { sku: {} } }) },
  },
};

describe('checkDatasets', () => {
  it('plans each measure, each dimension under a working measure, related dimensions and the time axis', async () => {
    const compile = vi.fn<CompileQuery>((_dataset, query) => {
      // A time measure needs a time axis; the check retries with one.
      if ((query.measures as string[] | undefined)?.includes('trailing') && !query.by) throw new Error('needs by');
      return statement(JSON.stringify(query));
    });
    const planned: string[] = [];
    const explain = vi.fn(async ({ sql }: { sql: string }) => {
      planned.push(sql);
      if (sql.includes('broken')) throw new Error('column "nope" does not exist');
      return sql.includes('"by"') ? ['filtered sequential scan'] : [];
    });

    const [result] = await checkDatasets({ orders }, compile, explain);

    expect(planned).toEqual([
      '{"measures":["revenue"]}',
      '{"measures":["trailing"],"by":"month"}',
      '{"measures":["broken"]}',
      '{"dimensions":["status"],"measures":["revenue"]}',
      '{"dimensions":["created_at"],"measures":["revenue"]}',
      // to-one relationships only; hasMany traversal is refused by the planner.
      '{"dimensions":["customer.country"],"measures":["revenue"]}',
      '{"by":"month","measures":["revenue"]}',
    ]);
    expect(result).toEqual({
      dataset: 'orders',
      queries: 7,
      failures: [{ label: 'measure broken', stage: 'plan', message: 'column "nope" does not exist' }],
      warnings: ['filtered sequential scan'],
    });
  });

  it('reports a query that does not compile, with the original error', async () => {
    const compile: CompileQuery = () => { throw new Error('Unknown measure'); };
    const [result] = await checkDatasets({ events: { dimensions: {}, measures: { n: {} } } }, compile, async () => []);
    expect(result!.failures).toEqual([{ label: 'measure n', stage: 'compile', message: 'Unknown measure' }]);
    expect(result!.queries).toBe(0);
  });

  it('plans preflight statements before the query', async () => {
    const planned: string[] = [];
    await checkDatasets(
      { events: { dimensions: {}, measures: { n: {} } } },
      () => ({ sql: 'main', parameters: [], preflightStatements: [{ sql: 'guard', parameters: [] }] }),
      async ({ sql }) => { planned.push(sql); return []; },
    );
    expect(planned).toEqual(['guard', 'main']);
  });
});

import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { rehydrateProtocolDatasets } from './protocol-rehydrate.js';
import { createPortableSemanticExecutor } from './portable-executor.js';
import { createQueryBuilder } from '../../clickhouse/src/index.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';

// RFC 0029 §4: timeKeys are published, never silently dropped.
const config = {
  source: 'orders',
  timeKey: 'createdAt',
  dimensions: {
    status: dimension.string(),
    createdAt: dimension.timestamp({ column: 'created_at' }),
    shippedAt: dimension.timestamp({ column: 'shipped_at' }),
    deliveredAt: dimension.timestamp({ column: 'delivered_at' }),
  },
  measures: { orders: measure.count('id') },
} as const;
const Orders = dataset('orders', { ...config, timeKeys: ['shippedAt', 'deliveredAt'] });
const Plain = dataset('orders', config);
const endpoints = { orders: { access: { kind: 'public' }, tenant: { kind: 'not-required' } } } as never;

describe('time keys in the deployment contract (RFC 0029)', () => {
  it('publishes timeKeys as contract 3 alternateTimeFields, in authored order', () => {
    const contract = buildProtocolDeploymentContract([Orders], { endpoints });
    expect(contract.version).toBe(3);
    expect(contract.datasets[0]).toMatchObject({ timeField: 'createdAt', alternateTimeFields: ['shippedAt', 'deliveredAt'] });
  });

  it('keeps a dataset without them on contract 2, byte for byte', () => {
    const contract = buildProtocolDeploymentContract([Plain], { endpoints });
    expect(contract.version).toBe(2);
    expect(JSON.stringify(contract)).not.toContain('alternateTimeFields');
  });

  it('rehydrates alternateTimeFields as timeKeys', () => {
    const contract = buildProtocolDeploymentContract([Orders], { endpoints });
    const rebuilt = rehydrateProtocolDatasets(contract.datasets).orders!;
    expect(rebuilt.timeKey).toBe('createdAt');
    expect(rebuilt.timeKeys).toEqual(['shippedAt', 'deliveredAt']);
  });

  it('runs a portable query on the selected time key', async () => {
    const statements: string[] = [];
    const real = createQueryBuilder({ host: 'http://127.0.0.1:1' });
    const wrap = (builder: object): QueryBuilderLike => new Proxy(builder, {
      get(target, property) {
        if (property === 'execute') {
          return async () => { statements.push((target as { toSQL(): string }).toSQL()); return []; };
        }
        const value = Reflect.get(target, property);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          const result = value.apply(target, args);
          return result && typeof result === 'object' && 'toSQL' in result ? wrap(result) : result;
        };
      },
    }) as QueryBuilderLike;
    const factory = { table: (name: string) => wrap(real.table(name as never)), rawQuery: async () => [] } as unknown as QueryBuilderFactoryLike;
    const contract = buildProtocolDeploymentContract([Orders], { endpoints });
    const execute = createPortableSemanticExecutor({ queryBuilder: factory, now: () => new Date('2026-11-22T10:00:00Z') });

    await execute({
      deployment: contract as never,
      dataset: contract.datasets[0] as never,
      operation: {
        kind: 'dataset', dataset: 'orders', measures: ['orders'], by: 'month', timeKey: 'shippedAt',
        filters: [{
          kind: 'comparison', operator: 'inDateRange',
          left: { kind: 'reference', name: 'shippedAt' }, right: { kind: 'literal', value: 'this quarter' },
        }],
      } as never,
      tenant: undefined,
      budget: { maxRows: 100 },
      activationRevision: 'c'.repeat(64),
    });

    expect(statements[0]).toContain('toStartOfMonth(');
    expect(statements[0]).toContain('orders.shipped_at');
    expect(statements[0]).toContain("'2026-10-01'");
    expect(statements[0]).toContain("'2027-01-01'");
    expect(statements[0]).not.toContain('created_at');
  });
});

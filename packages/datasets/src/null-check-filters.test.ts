import { describe, expect, it } from 'vitest';
import { validateProtocolDeploymentContract } from '@hypequery/protocol';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { rehydrateProtocolDatasets } from './protocol-rehydrate.js';
import { buildDatasetInputSchema } from './semantic-query-schema.js';
import { gte, isNotNull, isNull } from './query-helpers.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';
import { createQueryBuilder } from '../../clickhouse/src/index.js';

// RFC 0023: "has a churn date" is `churned_at IS NOT NULL`, not a sentinel range.
const config = {
  source: 'customers',
  timeKey: 'signedUpAt',
  dimensions: {
    plan: dimension.string(),
    trial: dimension.boolean(),
    seats: dimension.number(),
    signedUpAt: dimension.timestamp({ column: 'signed_up_at' }),
    churnedAt: dimension.timestamp({ column: 'churned_at' }),
  },
  measures: {
    customers: measure.count('id'),
    churnedCustomers: measure.count('id', { filters: [isNotNull('churnedAt')] }),
    activeCustomers: measure.count('id', { filters: [isNull('churnedAt')] }),
  },
  filters: {
    plan: { __type: 'filter_definition', field: 'plan' },
    trial: { __type: 'filter_definition', field: 'trial', operators: ['eq', 'isNull', 'isNotNull'] },
    churnedAt: { __type: 'filter_definition', field: 'churnedAt', operators: ['gte', 'isNull', 'isNotNull'] },
  },
} as const;
const Customers = dataset('customers', {
  ...config,
  segments: { churned: { filters: [isNotNull('churnedAt')] } },
});
// Deployment contract 2 cannot carry segments, so the published copy has none.
const PublishedCustomers = dataset('customers', config);

const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });

describe('null-check filters (RFC 0023)', () => {
  it('renders measure fixed filters as IS NULL / IS NOT NULL', () => {
    const sql = client.toSQL(Customers, { measures: ['churnedCustomers', 'activeCustomers'] });
    expect(sql).toContain('churned_at IS NOT NULL');
    expect(sql).toContain('churned_at IS NULL');
    expect(sql).not.toContain('1971');
  });

  it('plans an opted-in query filter through the builder, beside a value filter on the same field', () => {
    const sql = client.toSQL(Customers, {
      measures: ['customers'],
      filters: [isNotNull('churnedAt'), gte('churnedAt', '2026-01-01'), { field: 'trial', operator: 'isNull' }],
      timezone: 'Europe/Berlin',
    });
    expect(sql).toMatch(/churned_at\)? IS NOT NULL/);
    expect(sql).toMatch(/trial\)? IS NULL/);
  });

  it('renders through the @hypequery/clickhouse builder', () => {
    const real = createDatasetClient({ queryBuilder: createQueryBuilder({ host: 'http://127.0.0.1:8123' }) });
    const sql = real.toSQL(Customers, {
      measures: ['churnedCustomers'],
      filters: [isNull('trial'), isNotNull('churnedAt')],
    });
    expect(sql).toMatch(/trial\)? IS NULL/);
    expect(sql).toMatch(/churned_at\)? IS NOT NULL/);
  });

  it('applies segment null checks', () => {
    expect(client.toSQL(Customers, { measures: ['customers'], segments: ['churned'] })).toMatch(/churned_at\)? IS NOT NULL/);
  });

  it('keeps null checks opt-in for caller filters and refuses a value on them', async () => {
    const execute = async (filters: unknown) => client.execute(Customers, { measures: ['customers'], filters: filters as never });
    await expect(execute([{ field: 'plan', operator: 'isNull' }])).rejects.toThrow(/does not allow operator "isNull"/);
    await expect(execute([{ field: 'churnedAt', operator: 'isNotNull', value: '1971-01-01' }]))
      .rejects.toThrow(/"isNotNull" takes no value/);
    await expect(execute([{ field: 'trial', operator: 'isNull', value: null }])).rejects.toThrow(/"isNull" takes no value/);
  });

  it('evaluates null checks in the in-memory backend', async () => {
    const memory = createDatasetClient({
      backend: createInMemoryBackend({
        customers: [
          { id: 1, plan: 'pro', trial: false, seats: 3, signed_up_at: '2026-01-01', churned_at: null },
          { id: 2, plan: 'pro', trial: null, seats: 3, signed_up_at: '2026-01-01', churned_at: '2026-03-01' },
          { id: 3, plan: 'free', trial: true, seats: 1, signed_up_at: '2026-01-01', churned_at: '2026-04-01' },
        ],
      }),
    });
    const result = await memory.execute(Customers, {
      dimensions: ['plan'],
      measures: ['customers'],
      filters: [isNotNull('churnedAt')],
      orderBy: [{ field: 'plan', direction: 'asc' }],
    });
    expect(result.data.map(row => [row.plan, Number(row.customers)])).toEqual([['free', 1], ['pro', 1]]);
  });

  it('publishes a null check without a right operand and rehydrates it', () => {
    const contract = buildProtocolDeploymentContract([PublishedCustomers]);
    expect(validateProtocolDeploymentContract(contract)).toBeTruthy();
    const dataset = contract.datasets[0]!;
    const churned = dataset.measures.find(item => item.name === 'churnedCustomers') as { filters: unknown[] };
    expect(churned.filters).toEqual([
      { kind: 'comparison', operator: 'isNotNull', left: { kind: 'reference', name: 'churnedAt' } },
    ]);
    expect(dataset.filters.find(item => item.name === 'churnedAt')?.operators).toEqual(['gte', 'isNull', 'isNotNull']);
    // A filter without an explicit list publishes the unchanged default operators.
    expect(dataset.filters.find(item => item.name === 'plan')?.operators).not.toContain('isNull');

    const hydrated = rehydrateProtocolDatasets(contract.datasets).customers!;
    expect(hydrated.measures.churnedCustomers).toMatchObject({ filters: [{ operator: 'isNotNull' }] });
    expect(client.toSQL(hydrated, { measures: ['activeCustomers'] })).toContain('churned_at IS NULL');
  });

  it('accepts a value-free null check in the input schema only where the filter lists it', () => {
    const schema = buildDatasetInputSchema(Customers);
    const parse = (filters: unknown[]) => schema.safeParse({ measures: ['customers'], filters }).success;
    expect(parse([{ field: 'churnedAt', operator: 'isNotNull' }])).toBe(true);
    expect(parse([{ field: 'churnedAt', operator: 'gte', value: '2026-01-01' }])).toBe(true);
    expect(parse([{ field: 'churnedAt', operator: 'isNotNull', value: '1971-01-01' }])).toBe(false);
    expect(parse([{ field: 'churnedAt', operator: 'gte' }])).toBe(false);
    expect(parse([{ field: 'plan', operator: 'isNull' }])).toBe(false);
  });

  it('builds value-free helpers', () => {
    expect(isNull('churnedAt')).toEqual({ field: 'churnedAt', operator: 'isNull' });
    expect(isNotNull('churnedAt')).toEqual({ field: 'churnedAt', operator: 'isNotNull' });
  });
});

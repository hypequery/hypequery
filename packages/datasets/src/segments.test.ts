import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { divide } from './formulas.js';
import { belongsTo } from './relationships.js';
import { createDatasetClient } from './executor.js';
import { createInMemoryBackend } from './in-memory-backend.js';
import { getDatasetCatalog } from './catalog.js';
import { serializeSemanticContract } from './contract.js';
import { projectAgentSafeCatalog } from './agent-catalog.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { buildDatasetQuerySignature } from './cache/query-signature.js';
import type { QueryBuilderFactoryLike, QueryBuilderLike } from './query-builder-protocol.js';

function sqlFactory(): QueryBuilderFactoryLike {
  function createBuilder(table: string): QueryBuilderLike {
    const select: string[] = [];
    const where: string[] = [];
    const push = (part: string) => { select.push(part); return builder; };
    const builder = {
      select: (args: string | string[]) => { select.push(...(Array.isArray(args) ? args : [args])); return builder; },
      sum: (c: string, a?: string) => push(`SUM(${c}) AS ${a}`),
      count: (c: string, a?: string) => push(`COUNT(${c}) AS ${a}`),
      where: (c: string, op: string, value: unknown) => { where.push(`${c} ${op} ${JSON.stringify(value)}`); return builder; },
      groupBy: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      offset: () => builder,
      toSQLWithParams: () => ({
        sql: `SELECT ${select.join(', ')} FROM ${table}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`,
        parameters: [],
      }),
      execute: async () => [],
    } as unknown as QueryBuilderLike;
    return builder;
  }
  return { table: createBuilder, rawQuery: async () => [] };
}

const Customers = dataset('customers', {
  source: 'customers',
  dimensions: { id: dimension.string(), region: dimension.string() },
});

const Accounts = dataset('accounts', {
  source: 'accounts',
  tenantKey: 'tenant_id',
  dimensions: {
    // Not filterable by callers, but an author can still declare a segment on it.
    tier: dimension.string({ column: 'account_tier', filterable: false }),
    seats: dimension.number(),
    status: dimension.string(),
    tenantId: dimension.string({ column: 'tenant_id' }),
  },
  measures: {
    revenue: measure.sum('amount'),
    accounts: measure.count('id'),
    revenuePerAccount: measure.derived({
      uses: { revenue: 'revenue', accounts: 'accounts' },
      formula: ({ revenue, accounts }) => divide(revenue, accounts),
    }),
  },
  segments: {
    enterprise: {
      label: 'Enterprise',
      description: 'Enterprise-tier accounts',
      filters: [{ field: 'tier', operator: 'eq', value: 'enterprise' }],
    },
    large: { filters: [{ field: 'seats', operator: 'gte', value: 100 }] },
  },
  relationships: { customer: belongsTo(() => Customers, { from: 'customer_id', to: 'id' }) },
});

const tenant = { runtime: { tenant: { id: 't1' } } };

describe('segment definitions', () => {
  const base = {
    source: 'accounts',
    tenantKey: 'tenant_id',
    dimensions: {
      tier: dimension.string(),
      seats: dimension.number(),
      tenantId: dimension.string({ column: 'tenant_id' }),
    },
  };
  const define = (filters: unknown, name = 'seg') => () => dataset('bad', {
    ...base,
    segments: { [name]: { filters: filters as never } },
  });

  it('rejects malformed segments when the dataset is defined', () => {
    expect(define([])).toThrow(/Invalid segment "seg" on dataset "bad": filters must be a non-empty array/);
    expect(define([{ field: 'region', operator: 'eq', value: 'eu' }])).toThrow(/"region" is not a dimension/);
    expect(define([{ field: 'customer.region', operator: 'eq', value: 'eu' }])).toThrow(/segments cannot use relationships/);
    expect(define([{ field: 'tenantId', operator: 'eq', value: 't1' }])).toThrow(/tenant column/);
    expect(define([{ field: 'tier', operator: 'regex', value: 'x' }])).toThrow(/unsupported operator "regex"/);
    expect(define([{ field: 'seats', operator: 'gt', value: 'many' }])).toThrow(/Invalid segment "seg"/);
    expect(define([{ field: 'tier', operator: 'eq', value: 'x' }], 'not-an-id')).toThrow(/names must be identifiers/);
  });
});

describe('segment queries', () => {
  it('applies selected segments as conditions on the dimensions they name', () => {
    const client = createDatasetClient({ queryBuilder: sqlFactory() });
    const sql = client.toSQL(Accounts, { measures: ['revenue'], segments: ['enterprise', 'large'] }, tenant);
    expect(sql).toContain('account_tier eq "enterprise"');
    expect(sql).toContain('seats gte 100');
    expect(sql).toContain('tenant_id eq "t1"');
  });

  it('applies segments to metric queries and derived measures', () => {
    const client = createDatasetClient({ queryBuilder: sqlFactory() });
    const metric = Accounts.metric('revenue', { measure: 'revenue' });
    expect(client.toSQL(metric, { segments: ['enterprise'] }, tenant)).toContain('account_tier eq "enterprise"');
    expect(client.toSQL(Accounts, { measures: ['revenuePerAccount'], segments: ['large'] }, tenant))
      .toContain('seats gte 100');
  });

  it('validates the selection', () => {
    const client = createDatasetClient({ queryBuilder: sqlFactory() });
    expect(client.validate(Accounts, { measures: ['revenue'], segments: ['nope'] }, tenant).errors)
      .toContain('Unknown segment "nope" on dataset "accounts". Available: enterprise, large');
    expect(client.validate(Accounts, { measures: ['revenue'], segments: ['large', 'large'] }, tenant).errors)
      .toContain('Segment "large" is selected more than once.');
    expect(client.validate(Accounts.metric('revenue', { measure: 'revenue' }), { segments: ['nope'] }, tenant).valid)
      .toBe(false);
  });

  it('filters rows in the in-memory backend', async () => {
    const client = createDatasetClient({
      backend: createInMemoryBackend({
        accounts: [
          { id: 1, amount: 100, account_tier: 'enterprise', seats: 500, tenant_id: 't1' },
          { id: 2, amount: 50, account_tier: 'enterprise', seats: 10, tenant_id: 't1' },
          { id: 3, amount: 25, account_tier: 'free', seats: 900, tenant_id: 't1' },
        ],
      }),
    });
    const { data } = await client.execute(Accounts, { measures: ['revenue'], segments: ['enterprise', 'large'] }, tenant);
    expect(data).toEqual([{ revenue: '100' }]);
  });
});

describe('segment cache signatures', () => {
  it('distinguish selections but not their order', () => {
    const without = buildDatasetQuerySignature(Accounts, { measures: ['revenue'] }, tenant);
    const withBoth = buildDatasetQuerySignature(Accounts, { measures: ['revenue'], segments: ['enterprise', 'large'] }, tenant);
    const reordered = buildDatasetQuerySignature(Accounts, { measures: ['revenue'], segments: ['large', 'enterprise'] }, tenant);
    expect(withBoth).not.toBe(without);
    expect(reordered).toBe(withBoth);
    expect(without).not.toContain('segments');
  });

  it('change when a segment definition changes', () => {
    const edited = dataset('accounts', {
      source: 'accounts',
      tenantKey: 'tenant_id',
      dimensions: { tier: dimension.string({ column: 'account_tier' }) },
      measures: { revenue: measure.sum('amount') },
      segments: { enterprise: { filters: [{ field: 'tier', operator: 'in', value: ['enterprise', 'strategic'] }] } },
    });
    expect(buildDatasetQuerySignature(edited, { measures: ['revenue'], segments: ['enterprise'] }, tenant))
      .not.toBe(buildDatasetQuerySignature(Accounts, { measures: ['revenue'], segments: ['enterprise'] }, tenant));
  });
});

describe('segment catalogs and publishing', () => {
  it('lists segments by name, label, and description, never by their conditions', () => {
    const catalog = getDatasetCatalog(Accounts);
    expect(catalog.segments).toEqual({
      enterprise: { label: 'Enterprise', description: 'Enterprise-tier accounts' },
      large: {},
    });
    expect('segments' in getDatasetCatalog(Customers)).toBe(false);

    const contract = serializeSemanticContract({ accounts: Accounts, customers: Customers });
    expect(contract.datasets.accounts!.segments).toEqual(catalog.segments);
    // The conditions stay in the definition: no segment filter values leak.
    expect(JSON.stringify(contract)).not.toContain('"value":"enterprise"');
    expect(JSON.stringify(contract)).not.toContain('"value":100');

    const agent = projectAgentSafeCatalog(contract);
    const accounts = agent.datasets.find(item => item.name === 'accounts')!;
    expect(accounts.segments).toEqual([
      { name: 'enterprise', label: 'Enterprise', description: 'Enterprise-tier accounts' },
      { name: 'large' },
    ]);
    expect(JSON.stringify(agent)).not.toContain('"value"');
  });

  it('refuses to publish a dataset that declares segments', () => {
    expect(() => buildProtocolDeploymentContract([Accounts, Customers]))
      .toThrow(/Dataset "accounts" declares segments \(enterprise, large\), which cannot be published yet/);
  });
});

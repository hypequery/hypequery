import { describe, expect, it } from 'vitest';
import { dataset } from './dataset.js';
import { dimension } from './field.js';
import { measure } from './measure.js';
import { belongsTo } from './relationships.js';
import { createDatasetClient } from './executor.js';
import { getDatasetCatalog } from './catalog.js';
import { buildProtocolDeploymentContract } from './protocol-deployment-adapter.js';
import { rehydrateProtocolDatasets } from './protocol-rehydrate.js';
import { buildDatasetInputSchema } from './semantic-query-schema.js';
import { validateDatasetQuery } from './dataset-query.js';
import { createRenderingBuilderFactory } from './tests/support/sql-equality-harness.js';
import type { AnyDatasetInstance, MetricFilter } from './types.js';

// Declared filters add to the dimensions marked filterable; they do not replace them.
const Plans = dataset('plans', {
  source: 'plans',
  dimensions: {
    id: dimension.number(),
    tier: dimension.string(),
    region: dimension.string(),
    internal: dimension.string({ filterable: false }),
    label: dimension.string({ sql: 'upper(tier)', dependencies: ['tier'] }),
  },
  filters: {
    tier_filter: { __type: 'filter_definition', field: 'tier', operators: ['eq', 'in', 'isNull'] },
  },
});

const Accounts = dataset('accounts', {
  source: 'accounts',
  dimensions: {
    plan: dimension.string(),
    seats: dimension.number(),
    country: dimension.string({ column: 'country_code' }),
    notes: dimension.string({ filterable: false }),
    planId: dimension.number({ column: 'plan_id' }),
  },
  measures: { accounts: measure.count('plan') },
  filters: {
    plan_filter: { __type: 'filter_definition', field: 'plan', operators: ['eq', 'in'] },
    notes: { __type: 'filter_definition', field: 'notes', operators: ['eq'] },
  },
  relationships: {
    planInfo: belongsTo(() => Plans, { from: 'plan_id', to: 'id' }),
  },
});

const client = createDatasetClient({ queryBuilder: createRenderingBuilderFactory() });

function accepts(ds: AnyDatasetInstance, ...filters: MetricFilter[]): boolean {
  return validateDatasetQuery(ds, { measures: ['accounts'], filters }).valid;
}

function filterFields(ds: AnyDatasetInstance): string[] {
  const schema = buildDatasetInputSchema(ds);
  const fields = new Set<string>();
  for (const field of ['plan_filter', 'plan', 'seats', 'country', 'notes', 'planId',
    'planInfo.tier', 'planInfo.region', 'planInfo.id', 'planInfo.internal', 'planInfo.label', 'planInfo.tier_filter']) {
    if (schema.safeParse({ measures: ['accounts'], filters: [{ field, operator: 'eq', value: 1 }] }).success
      || schema.safeParse({ measures: ['accounts'], filters: [{ field, operator: 'eq', value: 'x' }] }).success) {
      fields.add(field);
    }
  }
  return [...fields].sort();
}

describe('filterable dimensions alongside declared filters', () => {
  it('accepts filters on every filterable dimension, not only the declared ones', () => {
    expect(accepts(Accounts, { field: 'plan_filter', operator: 'eq', value: 'pro' })).toBe(true);
    expect(accepts(Accounts, { field: 'seats', operator: 'gte', value: 10 })).toBe(true);
    expect(accepts(Accounts, { field: 'country', operator: 'like', value: 'U%' })).toBe(true);
    expect(accepts(Accounts, { field: 'planId', operator: 'in', value: [1, 2] })).toBe(true);
  });

  it('gives undeclared dimensions the default operators, without null checks', () => {
    const result = validateDatasetQuery(Accounts, {
      measures: ['accounts'],
      filters: [{ field: 'seats', operator: 'isNull' }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Filter "seats" does not allow operator "isNull"'));
  });

  it('applies the operators declared on a field when the dimension is named directly', () => {
    expect(accepts(Accounts, { field: 'plan', operator: 'in', value: ['pro'] })).toBe(true);
    expect(accepts(Accounts, { field: 'plan', operator: 'like', value: '%' })).toBe(false);
    expect(accepts(Accounts, { field: 'plan_filter', operator: 'like', value: '%' })).toBe(false);
  });

  it('keeps filterable false dimensions out unless a filter declares them', () => {
    expect(accepts(Plans as never, { field: 'internal', operator: 'eq', value: 'x' })).toBe(false);
    expect(accepts(Accounts, { field: 'notes', operator: 'eq', value: 'x' })).toBe(true);
    expect(accepts(Accounts, { field: 'notes', operator: 'neq', value: 'x' })).toBe(false);
  });

  it('still rejects unknown fields and value types', () => {
    expect(accepts(Accounts, { field: 'missing', operator: 'eq', value: 'x' })).toBe(false);
    expect(accepts(Accounts, { field: 'seats', operator: 'eq', value: 'many' })).toBe(false);
  });

  it('renders an undeclared dimension filter against its column', () => {
    const sql = client.toSQL(Accounts, {
      measures: ['accounts'],
      filters: [{ field: 'country', operator: 'eq', value: 'US' }],
    });
    expect(sql).toContain('country_code');
  });

  it('accepts relationship filters on every filterable non-SQL target dimension', () => {
    expect(accepts(Accounts, { field: 'planInfo.tier', operator: 'eq', value: 'gold' })).toBe(true);
    expect(accepts(Accounts, { field: 'planInfo.region', operator: 'like', value: 'eu%' })).toBe(true);
    expect(accepts(Accounts, { field: 'planInfo.id', operator: 'gte', value: 1 })).toBe(true);
    // The target's declared operators still apply across the hop.
    expect(accepts(Accounts, { field: 'planInfo.tier', operator: 'isNull' })).toBe(true);
    expect(accepts(Accounts, { field: 'planInfo.tier', operator: 'like', value: '%' })).toBe(false);
    expect(accepts(Accounts, { field: 'planInfo.region', operator: 'isNull' })).toBe(false);
    // Not filterable, SQL-backed, or an alias: not reachable through the hop.
    expect(accepts(Accounts, { field: 'planInfo.internal', operator: 'eq', value: 'x' })).toBe(false);
    expect(accepts(Accounts, { field: 'planInfo.label', operator: 'eq', value: 'x' })).toBe(false);
    expect(accepts(Accounts, { field: 'planInfo.tier_filter', operator: 'eq', value: 'x' })).toBe(false);

    const sql = client.toSQL(Accounts, {
      measures: ['accounts'],
      filters: [{ field: 'planInfo.region', operator: 'eq', value: 'eu' }],
    });
    expect(sql).toMatch(/JOIN/);
    expect(sql).toContain('region');
  });

  it('advertises the same fields and operators in buildDatasetInputSchema', () => {
    expect(filterFields(Accounts)).toEqual([
      'country', 'notes', 'plan', 'planId',
      'planInfo.id', 'planInfo.region', 'planInfo.tier', 'plan_filter', 'seats',
    ]);
    const schema = buildDatasetInputSchema(Accounts);
    const parse = (filter: Record<string, unknown>) => schema.safeParse({ measures: ['accounts'], filters: [filter] }).success;
    expect(parse({ field: 'plan', operator: 'in', value: ['pro'] })).toBe(true);
    expect(parse({ field: 'plan', operator: 'like', value: '%' })).toBe(false);
    expect(parse({ field: 'seats', operator: 'isNull' })).toBe(false);
    expect(parse({ field: 'planInfo.tier', operator: 'isNull' })).toBe(true);
    expect(parse({ field: 'planInfo.region', operator: 'isNull' })).toBe(false);
  });

  it('builds the schema from a serialized catalog too', () => {
    const schema = buildDatasetInputSchema(getDatasetCatalog(Accounts));
    const parse = (filter: Record<string, unknown>) => schema.safeParse({ measures: ['accounts'], filters: [filter] }).success;
    expect(parse({ field: 'seats', operator: 'gte', value: 1 })).toBe(true);
    expect(parse({ field: 'plan', operator: 'like', value: '%' })).toBe(false);
  });

  it('enforces runtime constraints on undeclared filterable dimensions', () => {
    expect(() => client.toSQL(Accounts, { measures: ['accounts'] }, {
      runtime: { constraints: [{ field: 'country', operator: 'eq', value: 'US' }] },
    })).not.toThrow();
    expect(() => client.toSQL(Accounts, { measures: ['accounts'] }, {
      runtime: { constraints: [{ field: 'country', operator: 'isNull' }] },
    })).toThrow('cannot enforce a runtime constraint');
  });

  it('applies to rehydrated contracts, whose filter map is the declared one', () => {
    const contract = buildProtocolDeploymentContract([Plans, Accounts]);
    const hydrated = rehydrateProtocolDatasets(contract.datasets);
    const accounts = hydrated.accounts!;
    expect(Object.keys(accounts.filters).sort()).toEqual(['notes', 'plan_filter']);
    expect(accepts(accounts, { field: 'seats', operator: 'gte', value: 10 })).toBe(true);
    expect(accepts(accounts, { field: 'plan', operator: 'like', value: '%' })).toBe(false);
    expect(accepts(accounts, { field: 'planInfo.region', operator: 'eq', value: 'eu' })).toBe(true);
    expect(filterFields(accounts)).toEqual(filterFields(Accounts));
  });

  it('applies to a rehydrated contract that declares no filters', () => {
    const Bare = dataset('bare', {
      source: 'bare',
      dimensions: { status: dimension.string(), secret: dimension.string({ filterable: false }) },
      measures: { accounts: measure.count('status') },
      filters: {},
    });
    const contract = buildProtocolDeploymentContract([Bare]);
    const bare = rehydrateProtocolDatasets(contract.datasets).bare!;
    expect(accepts(bare, { field: 'status', operator: 'eq', value: 'x' })).toBe(true);
    expect(accepts(bare, { field: 'secret', operator: 'eq', value: 'x' })).toBe(false);
  });

  it('does not change the published catalog or contract', () => {
    expect(Object.keys(getDatasetCatalog(Accounts).filters).sort()).toEqual(['notes', 'plan_filter']);
    const contract = buildProtocolDeploymentContract([Plans, Accounts]);
    const accounts = contract.datasets.find(item => item.name === 'accounts')!;
    expect(accounts.filters.map(filter => filter.name).sort()).toEqual(['notes', 'plan_filter']);
  });
});

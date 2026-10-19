import { describe, expect, it, vi } from 'vitest';
import { projectAgentSafeCatalog } from '@hypequery/datasets';
import { projectAuthorizedDeploymentContract } from './authorized-contract.js';
import {
  createDeploymentSemanticDataPlane,
  DeploymentSemanticInvocationError,
  type DeploymentSemanticDataPlaneOptions,
  type DeploymentSemanticExecutionInput,
} from './semantic-data-plane.js';

/**
 * K-07 / RFC 0018: field visibility and provider-enforced constraints. The
 * data plane and the discovery projection read one resolver, so these cases
 * check both against the same policies.
 */

const REVISION = 'a'.repeat(64);
const ENDPOINT = {
  access: { kind: 'authenticated', roles: ['analyst'], scopes: [] },
  tenant: { kind: 'not-required' },
} as const;

const dimension = (name: string, column = name) => ({
  name, type: 'string', source: { kind: 'column', column }, filterable: true, groupable: true,
});

function contract() {
  return {
    kind: 'hypequery-deployment',
    version: 2,
    datasets: [
      {
        name: 'customers',
        source: 'analytics.customers',
        tenant: { kind: 'not-required' },
        dimensions: [dimension('id'), dimension('segment'), dimension('creditLimit')],
        measures: [], filters: [], relationships: [],
        endpoint: ENDPOINT,
      },
      {
        name: 'shipments',
        source: 'analytics.shipments',
        tenant: { kind: 'not-required' },
        timeField: 'shippedAt',
        defaults: { dimensions: ['carrier', 'accountId'], timeGrain: 'month' },
        dimensions: [
          dimension('carrier'), dimension('region'), dimension('accountId'),
          { ...dimension('shippedAt'), type: 'timestamp' }, dimension('cost'),
        ],
        measures: [
          { name: 'shipments', aggregation: 'count', field: 'carrier', filters: [] },
          { name: 'freightCost', aggregation: 'sum', field: 'cost', filters: [] },
          {
            kind: 'derived', name: 'costPerShipment',
            uses: [{ alias: 'cost', measure: 'freightCost' }, { alias: 'n', measure: 'shipments' }],
            expression: {
              kind: 'binary', operator: 'divide',
              left: { kind: 'reference', name: 'cost' }, right: { kind: 'reference', name: 'n' },
            },
          },
        ],
        filters: [
          { name: 'region', field: 'region', operators: ['eq', 'in'] },
          { name: 'accountId', field: 'accountId', operators: ['eq', 'in'] },
        ],
        relationships: [{
          name: 'customer', kind: 'belongsTo', target: 'customers',
          from: 'accountId', to: 'id', queryable: true,
        }],
        limits: { maxFilters: 1 },
        endpoint: ENDPOINT,
      },
    ],
  };
}

const POLICY = {
  kind: 'hypequery-field-visibility',
  version: 1,
  datasets: {
    shipments: { dimensions: ['carrier', 'region'], measures: ['shipments', 'costPerShipment'] },
    customers: { dimensions: ['segment'], measures: [] },
  },
};

const ACCOUNT_42 = {
  kind: 'comparison', operator: 'eq',
  left: { kind: 'reference', name: 'accountId' },
  right: { kind: 'literal', value: '42' },
};

function withLimits(limits: Record<string, number>) {
  const base = contract();
  return {
    ...base,
    datasets: base.datasets.map(dataset => (dataset.name === 'shipments' ? { ...dataset, limits } : dataset)),
  };
}

function plane(overrides: Partial<DeploymentSemanticDataPlaneOptions> = {}) {
  const execute = vi.fn(async (_input: DeploymentSemanticExecutionInput) => ({
    kind: 'hypequery-semantic-invocation-result',
    version: 1,
    activationRevision: REVISION,
    data: [],
    meta: { rowCount: 0 },
  }));
  return {
    execute,
    plane: createDeploymentSemanticDataPlane({
      deployment: contract() as never,
      activationRevision: REVISION,
      authenticate: async () => ({ subject: 'embed:user-17', roles: ['analyst'], scopes: [] }),
      resolveFieldVisibility: async () => POLICY,
      execute,
      ...overrides,
    }),
  };
}

async function refusal(dataPlane: ReturnType<typeof plane>['plane'], operation: Record<string, unknown>) {
  try {
    await dataPlane.invoke({
      invocation: {
        kind: 'hypequery-semantic-invocation',
        version: 1,
        target: { project: 'acme', environment: 'production' },
        operation: { kind: 'dataset', ...operation },
      },
      credentials: 'token',
    });
  } catch (error) {
    if (error instanceof DeploymentSemanticInvocationError) {
      return { category: error.category, code: error.code, message: error.message };
    }
    throw error;
  }
  return null;
}

describe('field visibility in the data plane', () => {
  it('runs a query over visible fields only', async () => {
    const { plane: dataPlane, execute } = plane();
    expect(await refusal(dataPlane, {
      dataset: 'shipments', dimensions: ['carrier'], measures: ['shipments'],
    })).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('spells out only visible base measures when the caller omits measures', async () => {
    const { plane: dataPlane, execute } = plane();
    expect(await refusal(dataPlane, { dataset: 'shipments', dimensions: ['carrier'] })).toBeNull();
    expect(execute.mock.calls[0][0].operation).toMatchObject({ measures: ['shipments'] });
  });

  it('leaves an omitted measure list alone without a policy', async () => {
    const { plane: dataPlane, execute } = plane({ resolveFieldVisibility: async () => undefined });
    expect(await refusal(dataPlane, { dataset: 'shipments', dimensions: ['carrier'] })).toBeNull();
    expect(execute.mock.calls[0][0].operation).not.toHaveProperty('measures');
  });

  it('allows a joined field when the join key and target field are visible', async () => {
    const { plane: dataPlane } = plane({
      resolveFieldVisibility: async () => ({
        ...POLICY,
        datasets: {
          ...POLICY.datasets,
          shipments: { ...POLICY.datasets.shipments, dimensions: ['accountId', 'carrier'] },
        },
      }),
    });
    expect(await refusal(dataPlane, {
      dataset: 'shipments', dimensions: ['customer.segment'], measures: ['shipments'],
    })).toBeNull();
    expect(await refusal(dataPlane, {
      dataset: 'shipments', dimensions: ['customer.creditLimit'],
    })).toMatchObject({ category: 'input-invalid' });
  });

  it.each([
    ['a hidden measure', { measures: ['freightCost'] }, 'Unknown measure "freightCost".'],
    ['a derived measure over a hidden one', { measures: ['costPerShipment'] }, 'Unknown measure "costPerShipment".'],
    ['a hidden dimension', { dimensions: ['accountId'] }, 'Unknown or non-groupable dimension "accountId".'],
    ['a hidden joined field', { dimensions: ['customer.creditLimit'] }, 'Unknown or non-groupable dimension "customer.creditLimit".'],
    ['grouping by period over a hidden time field', { measures: ['shipments'], by: 'month' }, 'Time grain "month" is not supported here.'],
    ['ordering by a hidden measure', { measures: ['shipments'], orderBy: [{ field: 'freightCost', direction: 'desc' }] }, 'Cannot order by "freightCost".'],
  ])('refuses %s exactly as if it did not exist', async (_, operation, message) => {
    const { plane: dataPlane, execute } = plane();
    expect(await refusal(dataPlane, { dataset: 'shipments', ...operation })).toMatchObject({
      category: 'input-invalid',
      message,
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a filter on a hidden field', async () => {
    const { plane: dataPlane } = plane();
    expect(await refusal(dataPlane, {
      dataset: 'shipments', measures: ['shipments'], filters: [ACCOUNT_42],
    })).toMatchObject({ category: 'input-invalid', message: 'Unknown or unfilterable field "accountId".' });
  });

  it('answers a hidden dataset as not found, like one the contract never had', async () => {
    const { plane: dataPlane } = plane({
      resolveFieldVisibility: async () => ({ ...POLICY, datasets: { shipments: POLICY.datasets.shipments } }),
    });
    expect(await refusal(dataPlane, { dataset: 'customers', dimensions: ['segment'] })).toMatchObject({
      category: 'not-found', code: 'HQ_SEMANTIC_DATASET_NOT_FOUND',
    });
  });

  it('answers a hidden dataset as not found before any access or tenant check', async () => {
    const resolveTenant = vi.fn(async () => null);
    const tenantBound = contract();
    const customers = tenantBound.datasets[0]!;
    (customers as Record<string, unknown>).tenant = { kind: 'required', field: 'tenant_id' };
    (customers as Record<string, unknown>).endpoint = {
      access: { kind: 'authenticated', roles: ['admin'], scopes: [] },
      tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
    };
    const { plane: dataPlane } = plane({
      deployment: tenantBound as never,
      resolveTenant,
      resolveFieldVisibility: async () => ({ ...POLICY, datasets: { shipments: POLICY.datasets.shipments } }),
    });
    expect(await refusal(dataPlane, { dataset: 'customers', dimensions: ['segment'] })).toMatchObject({
      category: 'not-found', code: 'HQ_SEMANTIC_DATASET_NOT_FOUND',
    });
    expect(resolveTenant).not.toHaveBeenCalled();
  });

  it('refuses a joined field whose local key is hidden', async () => {
    const { plane: dataPlane } = plane({
      resolveFieldVisibility: async () => ({
        ...POLICY,
        datasets: { ...POLICY.datasets, customers: { dimensions: '*', measures: '*' } },
      }),
    });
    // customer.id would read back the hidden accountId.
    expect(await refusal(dataPlane, { dataset: 'shipments', dimensions: ['customer.id'] })).toMatchObject({
      category: 'input-invalid',
    });
  });

  it('treats an invalid policy as a configuration fault, never as no restriction', async () => {
    const { plane: dataPlane, execute } = plane({ resolveFieldVisibility: async () => ({ datasets: {} }) });
    expect(await refusal(dataPlane, { dataset: 'shipments', measures: ['shipments'] })).toMatchObject({
      category: 'configuration-invalid',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('applies no restriction when the resolver returns undefined', async () => {
    const { plane: dataPlane } = plane({ resolveFieldVisibility: async () => undefined });
    expect(await refusal(dataPlane, { dataset: 'shipments', measures: ['freightCost'] })).toBeNull();
  });
});

describe('enforced constraints in the data plane', () => {
  const region = {
    kind: 'comparison', operator: 'eq',
    left: { kind: 'reference', name: 'region' }, right: { kind: 'literal', value: 'EMEA' },
  };

  it('ANDs constraints after the caller filters, on fields the caller cannot see', async () => {
    const { plane: dataPlane, execute } = plane({
      deployment: withLimits({ maxFilters: 2 }) as never,
      resolveConstraints: async () => [ACCOUNT_42],
    });
    expect(await refusal(dataPlane, {
      dataset: 'shipments', measures: ['shipments'], filters: [region],
    })).toBeNull();
    expect(execute.mock.calls[0]![0].operation.filters).toEqual([region, ACCOUNT_42]);
  });

  it('counts constraints toward the filter ceiling and says how many remain', async () => {
    const { plane: dataPlane, execute } = plane({ resolveConstraints: async () => [ACCOUNT_42] });
    // maxFilters is 1 and the constraint takes it.
    expect(await refusal(dataPlane, {
      dataset: 'shipments', measures: ['shipments'], filters: [region],
    })).toMatchObject({ category: 'input-invalid', message: 'At most 0 filters may be applied.' });
    expect(execute).not.toHaveBeenCalled();

    const { plane: tooMany } = plane({ resolveConstraints: async () => [ACCOUNT_42, ACCOUNT_42] });
    expect(await refusal(tooMany, { dataset: 'shipments', measures: ['shipments'] })).toMatchObject({
      category: 'forbidden', code: 'HQ_SEMANTIC_CONSTRAINT_UNENFORCEABLE',
    });
  });

  it('refuses a dataset that cannot enforce a constraint, without describing it', async () => {
    const { plane: dataPlane, execute } = plane({
      resolveFieldVisibility: async () => undefined,
      resolveConstraints: async () => [ACCOUNT_42],
    });
    expect(await refusal(dataPlane, { dataset: 'customers', dimensions: ['segment'] })).toMatchObject({
      category: 'forbidden',
      code: 'HQ_SEMANTIC_CONSTRAINT_UNENFORCEABLE',
      message: 'The principal lacks required access.',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['not an array', ACCOUNT_42],
    ['a non-comparison', [{ kind: 'logical', operator: 'or', operands: [ACCOUNT_42, ACCOUNT_42] }]],
  ])('refuses constraints that are %s', async (_, constraints) => {
    const { plane: dataPlane, execute } = plane({ resolveConstraints: async () => constraints });
    const outcome = await refusal(dataPlane, { dataset: 'shipments', measures: ['shipments'] });
    expect(outcome).not.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('field visibility in discovery', () => {
  const policy = POLICY;
  const principal = { subject: 'embed:user-17', roles: ['analyst'], scopes: [] };

  it('advertises exactly what the data plane accepts, as a valid contract', () => {
    const { contract: projected, queryable } = projectAuthorizedDeploymentContract(
      contract() as never, principal, { visibility: policy },
    );
    expect(queryable).toEqual(['customers', 'shipments']);
    const shipments = projected.datasets.find(dataset => dataset.name === 'shipments')!;
    const exposed = shipments.dimensions
      .filter(dimension => dimension.groupable || dimension.filterable)
      .map(dimension => dimension.name);
    expect(exposed).toEqual(['carrier', 'region']);
    expect(shipments.measures.map(measure => measure.name)).toEqual(['shipments']);
    expect(shipments.filters.map(filter => filter.name)).toEqual(['region']);
    expect(shipments.timeField).toBeUndefined();
    expect(shipments.defaults).toEqual({ dimensions: ['carrier'] });
    const concealed = shipments.dimensions.find(dimension => dimension.name === 'accountId')!;
    expect(concealed).toEqual({
      name: 'accountId', type: 'string', source: { kind: 'column', column: 'accountId' },
      filterable: false, groupable: false,
    });

    const customers = projected.datasets.find(dataset => dataset.name === 'customers')!;
    expect(customers.dimensions.filter(dimension => dimension.groupable).map(dimension => dimension.name))
      .toEqual(['segment']);
  });

  it('keeps a join-only target to the dimensions its policy entry shows', () => {
    const base = contract();
    // The principal may not address customers directly, only join to it.
    (base.datasets[0] as Record<string, unknown>).endpoint = {
      access: { kind: 'authenticated', roles: ['admin'], scopes: [] },
      tenant: { kind: 'not-required' },
    };
    const { contract: projected, queryable } = projectAuthorizedDeploymentContract(
      base as never,
      principal,
      {
        visibility: {
          ...POLICY,
          datasets: {
            shipments: { dimensions: ['accountId', 'carrier'], measures: '*' },
            customers: { dimensions: ['segment'], measures: [] },
          },
        },
      },
    );
    expect(queryable).toEqual(['shipments']);
    const customers = projected.datasets.find(dataset => dataset.name === 'customers')!;
    expect(customers.endpoint).toBeUndefined();
    expect(customers.dimensions.filter(dimension => dimension.groupable).map(dimension => dimension.name))
      .toEqual(['segment']);
  });

  it('removes a hidden dataset entirely when no visible join needs it', () => {
    const { contract: projected, queryable } = projectAuthorizedDeploymentContract(
      contract() as never,
      principal,
      { visibility: { ...POLICY, datasets: { shipments: { dimensions: ['accountId', 'carrier'], measures: '*' } } } },
    );
    expect(queryable).toEqual(['shipments']);
    expect(projected.datasets.map(dataset => dataset.name)).toEqual(['shipments']);
  });

  it('feeds an agent-safe catalog that names no hidden field', () => {
    const { contract: projected, queryable } = projectAuthorizedDeploymentContract(
      contract() as never, principal, { visibility: policy },
    );
    const catalog = projectAgentSafeCatalog({
      ...projected,
      datasets: projected.datasets.filter(dataset => queryable.includes(String(dataset.name))),
    } as never);
    const text = JSON.stringify(catalog);
    for (const hidden of ['freightCost', 'costPerShipment', 'accountId', 'creditLimit', '"cost"', 'shippedAt']) {
      expect(text).not.toContain(hidden);
    }
    expect(text).toContain('"shipments"');
    expect(text).toContain('"carrier"');
  });

  it('drops a relationship to a hidden target, so its name is not advertised', () => {
    const { contract: projected } = projectAuthorizedDeploymentContract(
      contract() as never,
      principal,
      { visibility: { ...POLICY, datasets: { shipments: { dimensions: ['accountId', 'carrier'], measures: '*' } } } },
    );
    expect(projected.datasets.map(dataset => dataset.name)).toEqual(['shipments']);
    expect(projected.datasets[0]!.relationships).toEqual([]);
    expect(JSON.stringify(projectAgentSafeCatalog(projected as never))).not.toContain('customer');
  });

  it('omits defaults that would be empty once the time field is hidden', () => {
    const base = contract();
    const shipments = base.datasets[1] as Record<string, unknown>;
    shipments.defaults = { timeGrain: 'month' };
    const { contract: projected } = projectAuthorizedDeploymentContract(
      base as never, principal, { visibility: POLICY },
    );
    expect(projected.datasets.find(dataset => dataset.name === 'shipments')!.defaults).toBeUndefined();
  });

  it('validates the policy exactly as execution does', () => {
    expect(() => projectAuthorizedDeploymentContract(contract() as never, principal, {
      visibility: { ...POLICY, datasets: { shipments: { dimensions: 'all', measures: '*' } } },
    })).toThrow();
  });

  it('is unchanged without a policy', () => {
    const { contract: projected } = projectAuthorizedDeploymentContract(contract() as never, principal);
    const shipments = projected.datasets.find(dataset => dataset.name === 'shipments')!;
    expect(shipments.measures).toHaveLength(3);
    expect(shipments.timeField).toBe('shippedAt');
  });
});

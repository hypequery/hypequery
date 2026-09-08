import { validateProtocolDeploymentContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import {
  isDeploymentEndpointAuthorized,
  projectAuthorizedDeploymentContract,
  satisfiesDeploymentAccess,
} from './authorized-contract.js';
import type { DeploymentDataPlanePrincipal } from './data-plane.js';

const PUBLIC = {
  access: { kind: 'public' },
  tenant: { kind: 'not-required' },
} as const;

const ANALYST = {
  access: { kind: 'authenticated', roles: ['analyst'], scopes: ['datasets:query'] },
  tenant: { kind: 'not-required' },
} as const;

const FINANCE = {
  access: { kind: 'authenticated', roles: ['finance'], scopes: ['datasets:query'] },
  tenant: { kind: 'not-required' },
} as const;

const analyst: DeploymentDataPlanePrincipal = {
  subject: 'u1', roles: ['analyst'], scopes: ['datasets:query'],
};

function metric(name: string, endpoint: unknown, overrides: Record<string, unknown> = {}) {
  return {
    name,
    kind: 'metric',
    expression: { kind: 'aggregate', aggregation: 'sum', field: 'amount' },
    dimensions: [],
    filters: [],
    grains: [],
    endpoint,
    ...overrides,
  };
}

function dataset(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    source: `analytics.${name}`,
    tenant: { kind: 'not-required' },
    dimensions: [{
      name: 'id', type: 'number', source: { kind: 'column', column: 'id' },
      filterable: true, groupable: true,
    }],
    measures: [{ name: 'amount', aggregation: 'sum', field: 'id', filters: [] }],
    filters: [],
    metrics: [],
    relationships: [],
    ...overrides,
  };
}

function contract(overrides: Record<string, unknown> = {}) {
  return validateProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 1,
    datasets: [dataset('orders', { endpoint: ANALYST })],
    queries: [],
    artifacts: [],
    ...overrides,
  });
}

const names = (result: { contract: { datasets: readonly { name: string }[] } }) =>
  result.contract.datasets.map(entry => String(entry.name));

describe('authorized contract projection', () => {
  it('reads every declared role and scope, not any of them', () => {
    expect(satisfiesDeploymentAccess(PUBLIC.access, null)).toBe(true);
    expect(satisfiesDeploymentAccess(ANALYST.access, null)).toBe(false);
    expect(satisfiesDeploymentAccess(ANALYST.access, analyst)).toBe(true);
    expect(satisfiesDeploymentAccess(ANALYST.access, {
      subject: 'u1', roles: ['analyst'], scopes: [],
    })).toBe(false);
    expect(satisfiesDeploymentAccess({
      kind: 'authenticated', roles: ['analyst', 'finance'], scopes: [],
    }, analyst)).toBe(false);
  });

  it('treats an absent endpoint as unreachable rather than unguarded', () => {
    // A contract may describe a dataset it never published. Reading a missing
    // policy as "no restriction" would publish it to everyone.
    expect(isDeploymentEndpointAuthorized(undefined, analyst)).toBe(false);
    expect(isDeploymentEndpointAuthorized(PUBLIC, null)).toBe(true);
  });

  it('removes a dataset the principal cannot reach', () => {
    const source = contract({
      datasets: [dataset('orders', { endpoint: ANALYST }), dataset('payroll', { endpoint: FINANCE })],
    });

    expect(names(projectAuthorizedDeploymentContract(source, analyst))).toEqual(['orders']);
    expect(names(projectAuthorizedDeploymentContract(source, null))).toEqual([]);
  });

  it('filters metrics by their own endpoint, not the dataset\'s', () => {
    const source = contract({
      datasets: [dataset('orders', {
        endpoint: ANALYST,
        metrics: [metric('open', ANALYST), metric('restricted', FINANCE)],
      })],
    });

    const { contract: projected } = projectAuthorizedDeploymentContract(source, analyst);

    expect(projected.datasets[0].metrics.map(entry => String(entry.name))).toEqual(['open']);
  });

  it('keeps a reachable metric on a dataset the principal cannot address', () => {
    // A metric resolves against its own endpoint, so the two are independent.
    // The dataset stays, unpublished, because the metric still lives on it.
    const source = contract({
      datasets: [dataset('orders', { endpoint: FINANCE, metrics: [metric('open', ANALYST)] })],
    });

    const projected = projectAuthorizedDeploymentContract(source, analyst);
    const [orders] = projected.contract.datasets;

    expect(orders.endpoint).toBeUndefined();
    expect(orders.metrics.map(entry => String(entry.name))).toEqual(['open']);
    // Advertised, or the metric it carries would be undiscoverable; not a
    // `query_dataset` target, which execution would refuse.
    expect(projected.advertised).toEqual(['orders']);
    expect(projected.queryable).toEqual([]);
  });

  it('retains a relationship target without publishing it', () => {
    const source = contract({
      datasets: [
        dataset('orders', {
          endpoint: ANALYST,
          relationships: [{
            name: 'customer', kind: 'belongsTo', target: 'customers',
            from: 'id', to: 'id', queryable: true,
          }],
        }),
        dataset('customers', { endpoint: FINANCE, metrics: [metric('spend', FINANCE)] }),
      ],
    });

    const projected = projectAuthorizedDeploymentContract(source, analyst);
    const customers = projected.contract.datasets.find(entry => entry.name === 'customers')!;

    // Present, so the relationship still resolves and a one-hop dimension still
    // plans exactly as the data plane would plan it.
    expect(names(projected)).toEqual(['orders', 'customers']);
    // Not addressable, and carrying nothing of its own.
    expect(customers.endpoint).toBeUndefined();
    expect(customers.metrics).toEqual([]);
    expect(projected.contract.datasets[0].relationships).toHaveLength(1);
    // The join is traversable; the target is neither advertised nor a target.
    expect(projected.advertised).toEqual(['orders']);
    expect(projected.queryable).toEqual(['orders']);
  });

  it('does not publish a supporting dataset, whatever the contract still contains', () => {
    // The distinction has to leave this function, not just exist inside it.
    // `projectAgentSafeCatalog` and `rehydrateProtocolDatasets` enumerate every
    // dataset they are handed and neither consults an endpoint, so a caller
    // that advertised `contract.datasets` would disclose the dimensions and
    // measures of a dataset this principal has no access to at all.
    const source = contract({
      datasets: [
        dataset('orders', {
          endpoint: ANALYST,
          relationships: [{
            name: 'employee', kind: 'belongsTo', target: 'payroll',
            from: 'id', to: 'id', queryable: true,
          }],
        }),
        dataset('payroll', {
          endpoint: FINANCE,
          dimensions: [{
            name: 'salary', type: 'number', source: { kind: 'column', column: 'salary_cents' },
            filterable: true, groupable: true,
          }],
        }),
      ],
    });

    const projected = projectAuthorizedDeploymentContract(source, analyst);

    expect(names(projected)).toContain('payroll');
    expect(projected.advertised).toEqual(['orders']);
    expect(projected.queryable).toEqual(['orders']);
  });

  it('keeps a metric that groups across a relationship it retained', () => {
    // Dropping the unreachable target would invalidate this metric outright:
    // its declared dimension names a field on the other side of the join.
    const source = contract({
      datasets: [
        dataset('orders', {
          endpoint: ANALYST,
          relationships: [{
            name: 'customer', kind: 'belongsTo', target: 'customers',
            from: 'id', to: 'id', queryable: true,
          }],
          metrics: [metric('joined', ANALYST, { dimensions: ['customer.id'] })],
        }),
        dataset('customers', { endpoint: FINANCE }),
      ],
    });

    const projected = projectAuthorizedDeploymentContract(source, analyst);

    expect(projected.contract.datasets[0].metrics[0].dimensions).toEqual(['customer.id']);
  });

  it('follows a relationship chain so the projection still validates', () => {
    const source = contract({
      datasets: [
        dataset('orders', {
          endpoint: ANALYST,
          relationships: [{
            name: 'customer', kind: 'belongsTo', target: 'customers', from: 'id', to: 'id', queryable: true,
          }],
        }),
        dataset('customers', {
          endpoint: FINANCE,
          relationships: [{
            name: 'region', kind: 'belongsTo', target: 'regions', from: 'id', to: 'id', queryable: true,
          }],
        }),
        dataset('regions', { endpoint: FINANCE }),
      ],
    });

    // A one-hop retain would leave `customers.region` pointing at nothing.
    expect(names(projectAuthorizedDeploymentContract(source, analyst)))
      .toEqual(['orders', 'customers', 'regions']);
  });

  it('removes an unreachable named query and keeps the dataset its peer plans over', () => {
    const query = (name: string, endpoint: unknown) => ({
      name,
      input: { kind: 'void' },
      output: { kind: 'void' },
      implementation: {
        kind: 'semantic-plan',
        query: { kind: 'dataset', dataset: 'orders', dimensions: [], measures: [], filters: [], orderBy: [] },
      },
      endpoint: { ...(endpoint as object), method: 'GET', path: `/${name}` },
      tags: [],
    });
    const source = contract({
      datasets: [dataset('orders')],
      queries: [query('open', ANALYST), query('restricted', FINANCE)],
    });

    const projected = projectAuthorizedDeploymentContract(source, analyst);

    expect(projected.contract.queries.map(entry => String(entry.name))).toEqual(['open']);
    // `orders` publishes no endpoint of its own, so it survives only because a
    // retained query plans over it — and it must, or the result cannot validate.
    expect(names(projected)).toEqual(['orders']);
    expect(projected.contract.datasets[0].endpoint).toBeUndefined();
    expect(projected.queryable).toEqual([]);
  });

  it('narrows and never widens', () => {
    const source = contract({
      datasets: [dataset('orders', {
        endpoint: ANALYST,
        metrics: [metric('open', ANALYST), metric('restricted', FINANCE)],
      })],
    });

    const projected = projectAuthorizedDeploymentContract(source, analyst);

    // Everything the projection kept is present in the original, unchanged.
    expect(projected.contract.datasets[0].endpoint).toEqual(source.datasets[0].endpoint);
    expect(projected.contract.datasets[0].dimensions).toEqual(source.datasets[0].dimensions);
    expect(projected.contract.datasets[0].metrics.length)
      .toBeLessThan(source.datasets[0].metrics.length);
    // And a principal holding everything sees exactly the contract it started
    // from, so the projection is an identity when nothing is withheld.
    const superuser = { subject: 'root', roles: ['analyst', 'finance'], scopes: ['datasets:query'] };
    expect(projectAuthorizedDeploymentContract(source, superuser).contract).toEqual(source);
  });
});

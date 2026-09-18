import { validateProtocolDeploymentContract } from '@hypequery/protocol';
import { describe, expect, it } from 'vitest';
import {
  isDeploymentEndpointAuthorized,
  projectAuthorizedDeploymentContract,
  satisfiesDeploymentAccess,
} from './authorized-contract.js';
import type { DeploymentDataPlanePrincipal } from './principal.js';

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
    relationships: [],
    ...overrides,
  };
}

function contract(overrides: Record<string, unknown> = {}) {
  return validateProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 2,
    datasets: [dataset('orders', { endpoint: ANALYST })],
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

  it('removes a dataset nothing published, rather than reading it as unguarded', () => {
    const source = contract({ datasets: [dataset('orders')] });

    const projected = projectAuthorizedDeploymentContract(source, analyst);

    expect(names(projected)).toEqual([]);
    expect(projected.queryable).toEqual([]);
  });

  it('keeps a join target\'s dimensions but not its measures or filters', () => {
    // A join carries the target's dimensions and nothing else, so those are
    // genuinely reachable: `resolveDataset` offers each groupable one as
    // `customer.<name>`. Its measures and declared filters were never reachable
    // through the join, so they narrow like anything else.
    const source = contract({
      datasets: [
        dataset('orders', {
          endpoint: ANALYST,
          relationships: [{
            name: 'customer', kind: 'belongsTo', target: 'customers',
            from: 'id', to: 'id', queryable: true,
          }],
        }),
        dataset('customers', {
          endpoint: FINANCE,
          dimensions: [
            { name: 'id', type: 'number', source: { kind: 'column', column: 'id' }, filterable: true, groupable: true },
            { name: 'tier', type: 'string', source: { kind: 'column', column: 'tier' }, filterable: true, groupable: true },
          ],
          measures: [{ name: 'lifetimeValue', aggregation: 'sum', field: 'id', filters: [] }],
          filters: [{ name: 'tier', field: 'tier', operators: ['eq'] }],
        }),
      ],
    });

    const projected = projectAuthorizedDeploymentContract(source, analyst);
    const customers = projected.contract.datasets.find(entry => entry.name === 'customers')!;

    // Reachable as `customer.id` / `customer.tier` from `orders`, so kept.
    expect(customers.dimensions.map(entry => String(entry.name))).toEqual(['id', 'tier']);
    // Never reachable through the join.
    expect(customers.measures).toEqual([]);
    expect(customers.filters).toEqual([]);
    expect(projected.queryable).toEqual(['orders']);
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
        dataset('customers', { endpoint: FINANCE }),
      ],
    });

    const projected = projectAuthorizedDeploymentContract(source, analyst);
    const customers = projected.contract.datasets.find(entry => entry.name === 'customers')!;

    // Present, so the relationship still resolves and a one-hop dimension still
    // plans exactly as the data plane would plan it.
    expect(names(projected)).toEqual(['orders', 'customers']);
    // Not addressable, and carrying nothing of its own.
    expect(customers.endpoint).toBeUndefined();
    expect(customers.measures).toEqual([]);
    expect(projected.contract.datasets[0].relationships).toHaveLength(1);
    // The join is traversable; the target is not offered as a target.
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
    expect(projected.queryable).toEqual(['orders']);
  });

  it('drops a supporting dataset\'s defaults, which describe querying it directly', () => {
    const source = contract({
      datasets: [
        dataset('orders', {
          endpoint: ANALYST,
          relationships: [{
            name: 'customer', kind: 'belongsTo', target: 'customers',
            from: 'id', to: 'id', queryable: true,
          }],
        }),
        dataset('customers', { endpoint: FINANCE, defaults: { dimensions: ['id'] } }),
      ],
    });

    const customers = projectAuthorizedDeploymentContract(source, analyst)
      .contract.datasets.find(entry => entry.name === 'customers')!;

    expect(customers.defaults).toBeUndefined();
  });

  it('does not carry reach a second hop, which execution does not either', () => {
    // `resolveDataset` offers `<relationship>.<dimension>` for a relationship's
    // own target and does not recurse, so nothing published can reach a
    // second-hop dataset's fields. It has to stay in the contract for the chain
    // to validate; it must not be advertised with a schema it never exposed.
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
        dataset('regions', {
          endpoint: FINANCE,
          dimensions: [
            { name: 'id', type: 'number', source: { kind: 'column', column: 'id' }, filterable: true, groupable: true },
            { name: 'costCentre', type: 'string', source: { kind: 'column', column: 'cc' }, filterable: true, groupable: true },
          ],
        }),
      ],
    });

    const projected = projectAuthorizedDeploymentContract(source, analyst);
    const at = (name: string) => projected.contract.datasets.find(entry => entry.name === name)!;

    // One hop from a dataset the principal can query: reachable, so kept.
    expect(at('customers').dimensions.map(entry => String(entry.name))).toEqual(['id']);
    // Two hops: present so the chain validates, and stripped.
    expect(at('regions').dimensions).toEqual([]);
    expect(projected.queryable).toEqual(['orders']);
  });

  it('keeps an unreached dataset\'s time field, which every grained query reads', () => {
    const source = contract({
      datasets: [
        dataset('orders', {
          endpoint: ANALYST,
          relationships: [{
            name: 'audit', kind: 'hasMany', target: 'audits', from: 'id', to: 'id', queryable: false,
          }],
        }),
        dataset('audits', {
          endpoint: FINANCE,
          timeField: 'occurredAt',
          dimensions: [
            {
              name: 'occurredAt', type: 'timestamp', source: { kind: 'column', column: 'occurred_at' },
              filterable: true, groupable: true,
            },
            {
              name: 'actor', type: 'string', source: { kind: 'column', column: 'actor' },
              filterable: true, groupable: true,
            },
          ],
        }),
      ],
    });

    const audits = projectAuthorizedDeploymentContract(source, analyst)
      .contract.datasets.find(entry => entry.name === 'audits')!;

    expect(audits.dimensions.map(entry => String(entry.name))).toEqual(['occurredAt']);
  });

  it('does not treat a non-queryable relationship as carrying reach', () => {
    // `resolveDataset` skips a relationship that is not queryable, so its target
    // is no more reachable than a dataset nothing points at.
    const source = contract({
      datasets: [
        dataset('orders', {
          endpoint: ANALYST,
          relationships: [{
            name: 'audit', kind: 'hasMany', target: 'audits', from: 'id', to: 'id', queryable: false,
          }],
        }),
        dataset('audits', {
          endpoint: FINANCE,
          dimensions: [{
            name: 'actor', type: 'string', source: { kind: 'column', column: 'actor' },
            filterable: true, groupable: true,
          }],
        }),
      ],
    });

    const projected = projectAuthorizedDeploymentContract(source, analyst);

    expect(projected.contract.datasets.find(entry => entry.name === 'audits')!.dimensions)
      .toEqual([]);
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

  it('narrows and never widens', () => {
    const source = contract({
      datasets: [
        dataset('orders', {
          endpoint: ANALYST,
          relationships: [{
            name: 'customer', kind: 'belongsTo', target: 'customers', from: 'id', to: 'id', queryable: true,
          }],
        }),
        dataset('customers', { endpoint: FINANCE }),
      ],
    });

    const projected = projectAuthorizedDeploymentContract(source, analyst);
    const customers = projected.contract.datasets.find(entry => entry.name === 'customers')!;

    // Everything the projection kept is present in the original, unchanged.
    expect(projected.contract.datasets[0].endpoint).toEqual(source.datasets[0].endpoint);
    expect(projected.contract.datasets[0].dimensions).toEqual(source.datasets[0].dimensions);
    expect(customers.measures.length).toBeLessThan(source.datasets[1]!.measures.length);
    // And a principal holding everything sees exactly the contract it started
    // from, so the projection is an identity when nothing is withheld.
    const superuser = { subject: 'root', roles: ['analyst', 'finance'], scopes: ['datasets:query'] };
    expect(projectAuthorizedDeploymentContract(source, superuser).contract).toEqual(source);
  });
});

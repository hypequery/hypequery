import { describe, expect, it, vi } from 'vitest';
import {
  createDeploymentSemanticDataPlane,
  DeploymentSemanticInvocationError,
  toProtocolSemanticInvocationFailure,
  type DeploymentSemanticDataPlaneOptions,
  type DeploymentSemanticExecutionInput,
} from './semantic-data-plane.js';

const REVISION = 'a'.repeat(64);
const OTHER_REVISION = 'b'.repeat(64);

const AUTHENTICATED = {
  access: { kind: 'authenticated', roles: ['analyst'], scopes: ['datasets:query'] },
  tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
  maxLimit: 500,
} as const;

const PUBLIC = {
  access: { kind: 'public' },
  tenant: { kind: 'not-required' },
} as const;

function customers() {
  return {
    name: 'customers',
    source: 'analytics.customers',
    tenant: { kind: 'not-required' },
    dimensions: [
      {
        name: 'id', type: 'number', source: { kind: 'column', column: 'customer_id' },
        filterable: true, groupable: true,
      },
      {
        name: 'country', type: 'string', source: { kind: 'column', column: 'country_code' },
        filterable: true, groupable: true,
      },
    ],
    measures: [], filters: [], metrics: [], relationships: [],
    endpoint: PUBLIC,
  };
}

function orders() {
  return {
    name: 'orders',
    source: 'analytics.orders',
    tenant: { kind: 'required', field: 'tenant_id' },
    timeField: 'createdAt',
    dimensions: [
      {
        name: 'createdAt', type: 'timestamp', source: { kind: 'column', column: 'created_at' },
        filterable: true, groupable: true,
      },
      {
        name: 'customerId', type: 'number', source: { kind: 'column', column: 'customer_id' },
        filterable: true, groupable: true,
      },
      {
        name: 'status', type: 'string', source: { kind: 'column', column: 'status' },
        filterable: true, groupable: true,
      },
      // Present for the measure, never selectable.
      {
        name: 'amount', type: 'number', source: { kind: 'column', column: 'amount_cents' },
        filterable: false, groupable: false,
      },
      // Maps to the physical tenant column: the forged-tenant surface.
      {
        name: 'tenantId', type: 'string', source: { kind: 'column', column: 'tenant_id' },
        filterable: true, groupable: true,
      },
    ],
    measures: [
      { name: 'revenue', aggregation: 'sum', field: 'amount', filters: [] },
      { name: 'orderCount', aggregation: 'count', field: 'status', filters: [] },
    ],
    filters: [
      { name: 'status', field: 'status', operators: ['eq', 'in'] },
      { name: 'tenantId', field: 'tenantId', operators: ['eq'] },
    ],
    metrics: [{
      name: 'totalRevenue',
      kind: 'metric',
      expression: { kind: 'aggregate', aggregation: 'sum', field: 'amount' },
      dimensions: ['status'],
      filters: ['status'],
      grains: ['day', 'month'],
      endpoint: AUTHENTICATED,
    }],
    relationships: [{
      name: 'customer', kind: 'belongsTo', target: 'customers',
      from: 'customerId', to: 'id', queryable: true,
    }],
    limits: { maxResultSize: 1_000 },
    endpoint: AUTHENTICATED,
  };
}

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'hypequery-deployment',
    version: 1,
    datasets: [customers(), orders()],
    queries: [],
    artifacts: [],
    ...overrides,
  };
}

function invocation(operation: unknown, extras: Record<string, unknown> = {}) {
  return {
    kind: 'hypequery-semantic-invocation',
    version: 1,
    target: { project: 'acme', environment: 'production' },
    operation,
    ...extras,
  };
}

function result(rows: Record<string, unknown>[] = [{ status: 'paid' }]) {
  return {
    kind: 'hypequery-semantic-invocation-result',
    version: 1,
    activationRevision: REVISION,
    data: rows,
    meta: { rowCount: rows.length },
  };
}

function plane(overrides: Partial<DeploymentSemanticDataPlaneOptions> = {}) {
  const execute = vi.fn(async () => result());
  const options: DeploymentSemanticDataPlaneOptions = {
    deployment: deployment() as never,
    activationRevision: REVISION,
    authenticate: async () => ({ subject: 'u1', roles: ['analyst'], scopes: ['datasets:query'] }),
    resolveTenant: async () => 'acme',
    execute: execute as never,
    ...overrides,
  };
  return { plane: createDeploymentSemanticDataPlane(options), execute };
}

async function categoryOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    if (error instanceof DeploymentSemanticInvocationError) return error.category;
    return `unexpected:${String(error)}`;
  }
  return 'accepted';
}

const DATASET_QUERY = { kind: 'dataset', dataset: 'orders', dimensions: ['status'], measures: ['revenue'] };

describe('semantic data plane', () => {
  it('runs a dataset invocation through the full enforcement sequence', async () => {
    const { plane: dataPlane, execute } = plane();

    const output = await dataPlane.invoke({ invocation: invocation(DATASET_QUERY), credentials: 'token' });

    expect(output).toEqual(result());
    const input = execute.mock.calls[0][0] as unknown as DeploymentSemanticExecutionInput;
    expect(input.dataset.name).toBe('orders');
    expect(input.principal?.subject).toBe('u1');
    expect(input.tenant).toBe('acme');
    expect(input.activationRevision).toBe(REVISION);
  });

  it('resolves a metric target and its own endpoint policy', async () => {
    const { plane: dataPlane, execute } = plane();

    await dataPlane.invoke({
      invocation: invocation({ kind: 'metric', dataset: 'orders', metric: 'totalRevenue' }),
      credentials: 'token',
    });

    const input = execute.mock.calls[0][0] as unknown as DeploymentSemanticExecutionInput;
    expect(input.metric?.name).toBe('totalRevenue');
  });

  // -- tenancy ------------------------------------------------------------

  it('never lets a caller supply a tenant', async () => {
    const { plane: dataPlane, execute } = plane({ resolveTenant: async () => 'acme' });

    // The record has no tenant field at all, so a forged one is an unknown
    // field rather than a value the plane has to be careful to ignore.
    expect(await categoryOf(() => dataPlane.invoke({
      invocation: invocation(DATASET_QUERY, { tenant: 'globex' }),
      credentials: 'token',
    }))).toBe('input-invalid');
    expect(execute).not.toHaveBeenCalled();
  });

  it('applies the resolved tenant even when the caller filters the tenant column', async () => {
    const { plane: dataPlane, execute } = plane({ resolveTenant: async () => 'acme' });

    // `tenantId` is a published dimension over the physical tenant column, so
    // filtering it is legal — but it must not become the enforced tenant.
    await dataPlane.invoke({
      invocation: invocation({
        ...DATASET_QUERY,
        filters: [{
          kind: 'comparison', operator: 'eq',
          left: { kind: 'reference', name: 'tenantId' },
          right: { kind: 'literal', value: 'globex' },
        }],
      }),
      credentials: 'token',
    });

    const input = execute.mock.calls[0][0] as unknown as DeploymentSemanticExecutionInput;
    expect(input.tenant).toBe('acme');
  });

  it('gives each principal only its own resolved tenant', async () => {
    const resolveTenant = vi.fn(async ({ principal }) => (
      principal?.subject === 'u1' ? 'acme' : 'globex'
    ));
    const tenants: unknown[] = [];
    const { plane: dataPlane } = plane({
      resolveTenant: resolveTenant as never,
      authenticate: (async ({ credentials }) => ({
        subject: credentials === 'token-a' ? 'u1' : 'u2',
        roles: ['analyst'],
        scopes: ['datasets:query'],
      })) as never,
      execute: (async (input: DeploymentSemanticExecutionInput) => {
        tenants.push(input.tenant);
        return result();
      }) as never,
    });

    await dataPlane.invoke({ invocation: invocation(DATASET_QUERY), credentials: 'token-a' });
    await dataPlane.invoke({ invocation: invocation(DATASET_QUERY), credentials: 'token-b' });

    expect(tenants).toEqual(['acme', 'globex']);
  });

  it('fails closed when a required tenant cannot be resolved', async () => {
    const { plane: dataPlane, execute } = plane({ resolveTenant: async () => undefined });

    expect(await categoryOf(() => dataPlane.invoke({
      invocation: invocation(DATASET_QUERY), credentials: 'token',
    }))).toBe('tenant-required');
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed when a required tenant has no resolver configured', async () => {
    const { plane: dataPlane } = plane({ resolveTenant: undefined });

    expect(await categoryOf(() => dataPlane.invoke({
      invocation: invocation(DATASET_QUERY), credentials: 'token',
    }))).toBe('configuration-invalid');
  });

  // -- authentication and authorization -----------------------------------

  it('rejects an unauthenticated caller on an authenticated target', async () => {
    const { plane: dataPlane } = plane({ authenticate: async () => null });

    expect(await categoryOf(() => dataPlane.invoke({ invocation: invocation(DATASET_QUERY) })))
      .toBe('unauthenticated');
  });

  it('rejects a principal missing a required role or scope', async () => {
    const withRoles = (roles: string[], scopes: string[]) => plane({
      authenticate: (async () => ({ subject: 'u1', roles, scopes })) as never,
    }).plane;

    expect(await categoryOf(() => withRoles([], ['datasets:query']).invoke({
      invocation: invocation(DATASET_QUERY), credentials: 'token',
    }))).toBe('forbidden');
    expect(await categoryOf(() => withRoles(['analyst'], []).invoke({
      invocation: invocation(DATASET_QUERY), credentials: 'token',
    }))).toBe('forbidden');
  });

  // -- activation pinning --------------------------------------------------

  it('rejects a call pinned to a superseded activation', async () => {
    const { plane: dataPlane, execute } = plane();

    expect(await categoryOf(() => dataPlane.invoke({
      invocation: invocation(DATASET_QUERY, { activationRevision: OTHER_REVISION }),
      credentials: 'token',
    }))).toBe('stale-activation');
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not reveal whether a target exists in a generation the caller may not use', async () => {
    const { plane: dataPlane } = plane();

    // A stale pin against a dataset that does not exist still reports staleness,
    // so a caller cannot probe the newer generation's catalog.
    expect(await categoryOf(() => dataPlane.invoke({
      invocation: invocation(
        { kind: 'dataset', dataset: 'secrets', measures: [] },
        { activationRevision: OTHER_REVISION },
      ),
      credentials: 'token',
    }))).toBe('stale-activation');
  });

  it('accepts a call pinned to the active activation', async () => {
    const { plane: dataPlane } = plane();

    await expect(dataPlane.invoke({
      invocation: invocation(DATASET_QUERY, { activationRevision: REVISION }),
      credentials: 'token',
    })).resolves.toBeDefined();
  });

  // -- targeting -----------------------------------------------------------

  it('reports an unknown dataset, metric, or unpublished target as not found', async () => {
    const { plane: dataPlane } = plane();

    expect(await categoryOf(() => dataPlane.invoke({
      invocation: invocation({ kind: 'dataset', dataset: 'missing', measures: [] }),
      credentials: 'token',
    }))).toBe('not-found');
    expect(await categoryOf(() => dataPlane.invoke({
      invocation: invocation({ kind: 'metric', dataset: 'orders', metric: 'missing' }),
      credentials: 'token',
    }))).toBe('not-found');

    const unpublished = deployment({
      datasets: [customers(), { ...orders(), endpoint: undefined, metrics: [] }],
    });
    const bare = createDeploymentSemanticDataPlane({
      deployment: JSON.parse(JSON.stringify(unpublished)) as never,
      activationRevision: REVISION,
      execute: async () => result(),
    });
    expect(await categoryOf(() => bare.invoke({ invocation: invocation(DATASET_QUERY) })))
      .toBe('not-found');
  });

  // -- input validation ----------------------------------------------------

  it('rejects selections the contract never published', async () => {
    const { plane: dataPlane } = plane();
    const reject = async (operation: Record<string, unknown>) => categoryOf(() => dataPlane.invoke({
      invocation: invocation({ kind: 'dataset', dataset: 'orders', ...operation }),
      credentials: 'token',
    }));

    expect(await reject({ dimensions: ['nope'], measures: ['revenue'] })).toBe('input-invalid');
    // Declared, but neither filterable nor groupable.
    expect(await reject({ dimensions: ['amount'], measures: ['revenue'] })).toBe('input-invalid');
    expect(await reject({ dimensions: ['status'], measures: ['nope'] })).toBe('input-invalid');
    expect(await reject({ measures: [] })).toBe('input-invalid');
    expect(await reject({ dimensions: ['status'], measures: ['revenue'], by: 'century' }))
      .toBe('input-invalid');
  });

  it('narrows a metric to the dimensions and grains it declared', async () => {
    const { plane: dataPlane } = plane();
    const call = async (operation: Record<string, unknown>) => categoryOf(() => dataPlane.invoke({
      invocation: invocation({ kind: 'metric', dataset: 'orders', metric: 'totalRevenue', ...operation }),
      credentials: 'token',
    }));

    expect(await call({ dimensions: ['status'] })).toBe('accepted');
    expect(await call({ by: 'month' })).toBe('accepted');
    // The dataset groups by customerId, but this metric did not publish it.
    expect(await call({ dimensions: ['customerId'] })).toBe('input-invalid');
    // The dataset supports every grain; the metric published two.
    expect(await call({ by: 'year' })).toBe('input-invalid');
  });

  it('enforces the declared operator list on a filter', async () => {
    const { plane: dataPlane } = plane();
    const filter = (operator: string) => categoryOf(() => dataPlane.invoke({
      invocation: invocation({
        ...DATASET_QUERY,
        filters: [{
          kind: 'comparison', operator,
          left: { kind: 'reference', name: 'status' },
          right: { kind: 'literal', value: 'paid' },
        }],
      }),
      credentials: 'token',
    }));

    expect(await filter('eq')).toBe('accepted');
    expect(await filter('like')).toBe('input-invalid');
  });

  it('accepts a one-hop relationship dimension and rejects a deeper path', async () => {
    const { plane: dataPlane } = plane();
    const call = (name: string) => categoryOf(() => dataPlane.invoke({
      invocation: invocation({ kind: 'dataset', dataset: 'orders', dimensions: [name], measures: ['revenue'] }),
      credentials: 'token',
    }));

    expect(await call('customer.country')).toBe('accepted');
    expect(await call('customer.missing')).toBe('input-invalid');
  });

  // -- budgets -------------------------------------------------------------

  it('applies the most restrictive of caller, endpoint, dataset, and server limits', async () => {
    const { plane: dataPlane, execute } = plane({ limits: { maxRows: 2_000 } });

    await dataPlane.invoke({ invocation: invocation(DATASET_QUERY), credentials: 'token' });

    // endpoint.maxLimit is 500, below the dataset's 1000 and the server's 2000.
    const input = execute.mock.calls[0][0] as unknown as DeploymentSemanticExecutionInput;
    expect(input.budget.maxRows).toBe(500);
  });

  it('lets a caller tighten a budget but never widen one', async () => {
    const { plane: dataPlane, execute } = plane();

    await dataPlane.invoke({
      invocation: invocation(DATASET_QUERY, { budget: { maxRows: 10 } }),
      credentials: 'token',
    });
    expect((execute.mock.calls[0][0] as unknown as DeploymentSemanticExecutionInput).budget.maxRows)
      .toBe(10);

    const { plane: widened, execute: widenedExecute } = plane();
    await widened.invoke({
      invocation: invocation(DATASET_QUERY, { budget: { maxRows: 9_000 } }),
      credentials: 'token',
    });
    expect((widenedExecute.mock.calls[0][0] as unknown as DeploymentSemanticExecutionInput)
      .budget.maxRows).toBe(500);
  });

  it('rejects a row limit above the effective budget', async () => {
    const { plane: dataPlane } = plane();

    expect(await categoryOf(() => dataPlane.invoke({
      invocation: invocation({ ...DATASET_QUERY, limit: 501 }),
      credentials: 'token',
    }))).toBe('input-invalid');
    expect(await categoryOf(() => dataPlane.invoke({
      invocation: invocation({ ...DATASET_QUERY, limit: 500 }),
      credentials: 'token',
    }))).toBe('accepted');
  });

  // -- execution and output ------------------------------------------------

  it('maps an executor throw to executor-failed without leaking its cause', async () => {
    const { plane: dataPlane } = plane({
      execute: (async () => {
        throw new Error('ClickHouseException: DB::Exception: table analytics.orders');
      }) as never,
    });

    try {
      await dataPlane.invoke({ invocation: invocation(DATASET_QUERY), credentials: 'token' });
      throw new Error('expected a failure');
    } catch (error) {
      const failure = toProtocolSemanticInvocationFailure(error, REVISION);
      expect(failure.category).toBe('executor-failed');
      expect(failure.message).not.toContain('ClickHouseException');
      expect(failure.message).not.toContain('analytics.orders');
    }
  });

  it('rejects an executor result that does not match the portable record', async () => {
    const { plane: dataPlane } = plane({
      execute: (async () => ({ rows: [{ status: 'paid' }] })) as never,
    });

    expect(await categoryOf(() => dataPlane.invoke({
      invocation: invocation(DATASET_QUERY), credentials: 'token',
    }))).toBe('output-invalid');
  });

  it('reports cancellation rather than failure when the caller aborts', async () => {
    const controller = new AbortController();
    const { plane: dataPlane } = plane({
      execute: (async () => {
        controller.abort();
        throw new Error('aborted');
      }) as never,
    });

    expect(await categoryOf(() => dataPlane.invoke({
      invocation: invocation(DATASET_QUERY), credentials: 'token', signal: controller.signal,
    }))).toBe('cancelled');
  });

  it('refuses to start once the caller has already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { plane: dataPlane, execute } = plane();

    expect(await categoryOf(() => dataPlane.invoke({
      invocation: invocation(DATASET_QUERY), credentials: 'token', signal: controller.signal,
    }))).toBe('cancelled');
    expect(execute).not.toHaveBeenCalled();
  });

  // -- configuration -------------------------------------------------------

  it('rejects an invalid contract or activation revision at construction', () => {
    expect(() => createDeploymentSemanticDataPlane({
      deployment: { kind: 'nope' } as never,
      activationRevision: REVISION,
      execute: async () => result(),
    })).toThrow(DeploymentSemanticInvocationError);

    expect(() => createDeploymentSemanticDataPlane({
      deployment: deployment() as never,
      activationRevision: 'not-a-digest',
      execute: async () => result(),
    })).toThrow(RangeError);
  });

  it('projects an unknown throw as a closed failure record', () => {
    const failure = toProtocolSemanticInvocationFailure(new Error('secret detail'), REVISION);

    expect(failure).toMatchObject({
      kind: 'hypequery-semantic-invocation-failure',
      category: 'executor-failed',
      retryable: false,
      relist: false,
      activationRevision: REVISION,
    });
    expect(JSON.stringify(failure)).not.toContain('secret detail');
  });
});

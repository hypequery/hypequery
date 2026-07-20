import {
  validateProtocolDeploymentContract,
  type ProtocolDeploymentContract,
} from '@hypequery/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  createDeploymentDataPlane,
  DeploymentDataPlaneError,
} from './data-plane.js';

const ARTIFACT_SHA = 'a'.repeat(64);

function query(
  overrides: Record<string, unknown> = {},
) {
  return {
    name: 'handler',
    input: { kind: 'any' },
    output: { kind: 'any' },
    implementation: {
      kind: 'runtime-reference',
      runtime: 'node',
      artifactSha256: ARTIFACT_SHA,
      entrypoint: 'queries.handler',
    },
    endpoint: {
      access: { kind: 'public' },
      tenant: { kind: 'not-required' },
      method: 'POST',
      path: '/handler',
    },
    tags: [],
    ...overrides,
  };
}

function deployment(queries: readonly unknown[]): ProtocolDeploymentContract {
  return validateProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 1,
    datasets: [{
      name: 'orders',
      source: 'orders',
      tenant: { kind: 'not-required' },
      dimensions: [],
      measures: [],
      filters: [],
      metrics: [],
      relationships: [],
    }],
    queries,
    artifacts: [{ runtime: 'node', artifactSha256: ARTIFACT_SHA }],
  });
}

function expectDataPlaneError(
  operation: Promise<unknown>,
  code: DeploymentDataPlaneError['code'],
  path?: string,
) {
  return expect(operation).rejects.toMatchObject({
    name: 'DeploymentDataPlaneError',
    code,
    ...(path === undefined ? {} : { path }),
  });
}

describe('deployment data plane', () => {
  it('matches exact method/path pairs and distinguishes method mismatches', async () => {
    const plane = createDeploymentDataPlane({
      deployment: deployment([query()]),
      executeRuntimeReference: async () => 'ok',
    });

    await expectDataPlaneError(
      plane.execute({ method: 'GET', path: '/missing' }),
      'HQ_DATA_PLANE_ROUTE_NOT_FOUND',
    );
    await expectDataPlaneError(
      plane.execute({ method: 'GET', path: '/handler' }),
      'HQ_DATA_PLANE_METHOD_NOT_ALLOWED',
    );
    await expect(plane.execute({ method: 'POST', path: '/handler', input: 'hello' }))
      .resolves.toEqual({ query: 'handler', output: 'ok' });
  });

  it('applies defaults and strip semantics before execution and validates output', async () => {
    const executeRuntimeReference = vi.fn(async ({ input }) => ({
      ...(input as Record<string, unknown>),
      ignored: true,
    }));
    const plane = createDeploymentDataPlane({
      deployment: deployment([query({
        input: {
          kind: 'object',
          properties: {
            name: { kind: 'string', minLength: 1 },
            loud: { kind: 'boolean', default: false },
          },
          required: ['name'],
          unknownProperties: 'strip',
        },
        output: {
          kind: 'object',
          properties: {
            name: { kind: 'string' },
            loud: { kind: 'boolean' },
          },
          required: ['name', 'loud'],
          unknownProperties: 'strip',
        },
      })]),
      executeRuntimeReference,
    });

    const result = await plane.execute({
      method: 'POST',
      path: '/handler',
      input: { name: 'Ada', extra: 'removed' },
    });

    expect(executeRuntimeReference).toHaveBeenCalledWith(expect.objectContaining({
      input: { name: 'Ada', loud: false },
    }));
    expect(result.output).toEqual({ name: 'Ada', loud: false });
    expect(Object.isFrozen(result.output)).toBe(true);
    await expectDataPlaneError(
      plane.execute({ method: 'POST', path: '/handler', input: { name: '' } }),
      'HQ_DATA_PLANE_INPUT_INVALID',
      '$.name',
    );
  });

  it('enforces authentication, roles, scopes, and required tenant resolution', async () => {
    const executeRuntimeReference = vi.fn(async () => 'ok');
    const authenticate = vi.fn(async ({ credentials }) => credentials === 'valid' ? {
      subject: 'user-1',
      roles: ['admin'],
      scopes: ['query:read'],
    } : null);
    const resolveTenant = vi.fn(async ({ principal }) => principal ? 'tenant-1' : undefined);
    const plane = createDeploymentDataPlane({
      deployment: deployment([query({
        endpoint: {
          access: { kind: 'authenticated', roles: ['admin'], scopes: ['query:read'] },
          tenant: { kind: 'required', mode: 'auto-inject', column: 'tenant_id' },
          cacheTtlMs: 60_000,
          method: 'POST',
          path: '/handler',
        },
      })]),
      authenticate,
      resolveTenant,
      executeRuntimeReference,
    });

    await expectDataPlaneError(
      plane.execute({ method: 'POST', path: '/handler', input: null }),
      'HQ_DATA_PLANE_UNAUTHENTICATED',
    );
    const response = await plane.execute({
      method: 'POST',
      path: '/handler',
      input: null,
      credentials: 'valid',
    });

    expect(response.output).toBe('ok');
    expect(response).not.toHaveProperty('cacheTtlMs');
    expect(executeRuntimeReference).toHaveBeenCalledWith(expect.objectContaining({
      tenant: 'tenant-1',
      principal: expect.objectContaining({ subject: 'user-1' }),
    }));
  });

  it('ignores credentials on public routes when no authenticator is configured', async () => {
    const executeRuntimeReference = vi.fn(async () => 'ok');
    const plane = createDeploymentDataPlane({
      deployment: deployment([query()]),
      executeRuntimeReference,
    });

    await expect(plane.execute({
      method: 'POST',
      path: '/handler',
      input: null,
      credentials: 'incidental-token',
    })).resolves.toEqual({ query: 'handler', output: 'ok' });
    expect(executeRuntimeReference).toHaveBeenCalledWith(expect.objectContaining({
      principal: null,
    }));
  });

  it('resolves typed input and tenant bindings for compiled SQL', async () => {
    const executeCompiledSql = vi.fn(async () => [{ id: 'order-1' }]);
    const compiled = query({
      name: 'lookup',
      input: {
        kind: 'object',
        properties: { filter: {
          kind: 'object',
          properties: { id: { kind: 'string' } },
          required: ['id'],
          unknownProperties: 'reject',
        } },
        required: ['filter'],
        unknownProperties: 'reject',
      },
      output: { kind: 'array', items: { kind: 'any' } },
      implementation: {
        kind: 'compiled-sql',
        dialect: 'clickhouse',
        operation: 'select',
        statement: 'SELECT id FROM orders WHERE id={id:String} AND tenant_id={tenant:String}',
        parameters: [
          { name: 'id', source: { kind: 'input', path: 'filter.id' }, clickHouseType: 'String' },
          { name: 'tenant', source: { kind: 'tenant' }, clickHouseType: 'String' },
        ],
        readSources: ['orders'],
        tenant: { kind: 'required', parameter: 'tenant' },
      },
      endpoint: {
        access: { kind: 'public' },
        tenant: { kind: 'required', mode: 'manual' },
        method: 'GET',
        path: '/lookup',
      },
    });
    const plane = createDeploymentDataPlane({
      deployment: deployment([compiled]),
      resolveTenant: async () => 'tenant-1',
      executeCompiledSql,
    });

    await plane.execute({ method: 'GET', path: '/lookup', input: { filter: { id: 'order-1' } } });

    expect(executeCompiledSql).toHaveBeenCalledWith(expect.objectContaining({
      parameters: { id: 'order-1', tenant: 'tenant-1' },
      implementation: expect.objectContaining({ kind: 'compiled-sql' }),
    }));
  });

  it('delegates fixed semantic plans with the validated deployment snapshot', async () => {
    const executeSemanticPlan = vi.fn(async () => 42);
    const semantic = query({
      name: 'countOrders',
      output: { kind: 'integer' },
      implementation: {
        kind: 'semantic-plan',
        query: {
          kind: 'dataset',
          dataset: 'orders',
          dimensions: [],
          measures: [],
          filters: [],
          orderBy: [],
        },
      },
      endpoint: {
        access: { kind: 'public' },
        tenant: { kind: 'not-required' },
        method: 'GET',
        path: '/count',
      },
    });
    const contract = deployment([semantic]);
    const plane = createDeploymentDataPlane({ deployment: contract, executeSemanticPlan });

    await expect(plane.execute({ method: 'GET', path: '/count', input: null }))
      .resolves.toEqual({ query: 'countOrders', output: 42 });
    expect(executeSemanticPlan).toHaveBeenCalledWith(expect.objectContaining({
      deployment: expect.objectContaining({ kind: 'hypequery-deployment' }),
      implementation: expect.objectContaining({ kind: 'semantic-plan' }),
    }));
  });

  it('fails closed for invalid output, unavailable executors, and cancellation', async () => {
    const contract = deployment([query({ output: { kind: 'string' } })]);
    const invalidOutput = createDeploymentDataPlane({
      deployment: contract,
      executeRuntimeReference: async () => 42,
    });
    await expectDataPlaneError(
      invalidOutput.execute({ method: 'POST', path: '/handler', input: null }),
      'HQ_DATA_PLANE_OUTPUT_INVALID',
      '$',
    );

    const unavailable = createDeploymentDataPlane({ deployment: contract });
    await expectDataPlaneError(
      unavailable.execute({ method: 'POST', path: '/handler', input: null }),
      'HQ_DATA_PLANE_EXECUTOR_UNAVAILABLE',
    );

    const controller = new AbortController();
    controller.abort('cancelled');
    await expectDataPlaneError(
      invalidOutput.execute({
        method: 'POST', path: '/handler', input: null, signal: controller.signal,
      }),
      'HQ_DATA_PLANE_ABORTED',
    );
  });

  it('rejects unsafe and over-budget values before invoking executors', async () => {
    const executeRuntimeReference = vi.fn(async () => null);
    const plane = createDeploymentDataPlane({
      deployment: deployment([query()]),
      limits: { maxCollectionItems: 1 },
      executeRuntimeReference,
    });

    await expectDataPlaneError(
      plane.execute({ method: 'POST', path: '/handler', input: [1, 2] }),
      'HQ_DATA_PLANE_INPUT_INVALID',
    );
    expect(executeRuntimeReference).not.toHaveBeenCalled();
  });
});

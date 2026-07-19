import { describe, expect, it, vi } from 'vitest';
import {
  DeploymentActivationError,
  type DeploymentActivationRecord,
  type DeploymentActivationRegistry,
  type DeploymentActivationResult,
} from './activation.js';
import {
  createDeploymentControlPlane,
  type DeploymentControlPlaneAuthorizationInput,
} from './control-plane.js';
import {
  DEFAULT_DEPLOYMENT_CONTROL_PLANE_LIMITS,
  resolveDeploymentControlPlaneLimits,
} from './control-plane-limits.js';
import type {
  DeploymentAuthenticationInput,
  DeploymentIntake,
  DeploymentIntakeResponse,
} from './types.js';

const RELEASE = '1'.repeat(64);
const REVISION_ONE = '2'.repeat(64);
const REVISION_TWO = '3'.repeat(64);
const TARGET = Object.freeze({ project: 'analytics', environment: 'production' });

async function* noBody(): AsyncGenerator<Uint8Array> {}

async function* body(value: string, onRead?: () => void): AsyncGenerator<Uint8Array> {
  onRead?.();
  yield Buffer.from(value);
}

function activation(
  revision: string,
  previousRevision: string | null = null,
): DeploymentActivationRecord {
  return Object.freeze({
    kind: 'hypequery-deployment-activation',
    version: 1,
    revision,
    target: TARGET,
    releaseIdentity: RELEASE,
    previousRevision,
    previousReleaseIdentity: previousRevision === null ? null : RELEASE,
    activatedAt: '2026-07-19T12:00:00.000Z',
  });
}

function activationRequest(expectedRevision: string | null = null): string {
  return JSON.stringify({
    kind: 'hypequery-deployment-activation-request',
    version: 1,
    releaseIdentity: RELEASE,
    expectedRevision,
  });
}

function parsed(response: DeploymentIntakeResponse): any {
  return JSON.parse(response.body);
}

function fixture(overrides: {
  readonly authenticate?: (input: DeploymentAuthenticationInput) => Promise<string | null>;
  readonly authorize?: (
    input: DeploymentControlPlaneAuthorizationInput<string>
  ) => Promise<boolean>;
  readonly registry?: Partial<DeploymentActivationRegistry>;
  readonly intake?: DeploymentIntake;
  readonly limits?: { readonly maxActivationRequestBytes?: number; readonly maxHistoryPageSize?: number };
  readonly onActivation?: (activation: DeploymentActivationRecord) => void | Promise<void>;
  readonly onBackgroundError?: (error: unknown) => void;
} = {}) {
  const defaultActivation = activation(REVISION_ONE);
  const registry: DeploymentActivationRegistry = {
    activate: vi.fn(async (): Promise<DeploymentActivationResult> => ({
      status: 'activated',
      activation: defaultActivation,
    })),
    current: vi.fn(async () => defaultActivation),
    history: vi.fn(async () => [defaultActivation]),
    historyPage: vi.fn(async () => ({
      activations: Object.freeze([defaultActivation]),
      nextBefore: null,
    })),
    ...overrides.registry,
  };
  const intake = overrides.intake ?? {
    handle: vi.fn(async () => ({
      status: 202,
      headers: Object.freeze({ 'content-type': 'application/json' }),
      body: '{"status":"accepted"}\n',
    })),
  };
  const authenticate = vi.fn(overrides.authenticate ?? (async () => 'operator'));
  const authorize = vi.fn(overrides.authorize ?? (async () => true));
  const controlPlane = createDeploymentControlPlane({
    intake,
    activations: registry,
    authenticator: { authenticate },
    authorizer: { authorize },
    limits: overrides.limits,
    onActivation: overrides.onActivation,
    onBackgroundError: overrides.onBackgroundError,
  });
  return { controlPlane, registry, intake, authenticate, authorize };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    path: '/v1/deployments/targets/analytics/production/activation',
    query: {},
    headers: { authorization: 'Bearer secret' },
    body: noBody(),
    hasBody: false,
    ...overrides,
  };
}

describe('deployment control plane', () => {
  it('delegates the streaming submission route to deployment intake', async () => {
    const { controlPlane, intake, authenticate } = fixture();
    const submission = request({
      method: 'POST',
      path: '/v1/deployments/submissions',
      headers: { 'content-type': 'multipart/form-data' },
    });

    const response = await controlPlane.handle(submission);

    expect(response.status).toBe(202);
    expect(intake.handle).toHaveBeenCalledWith(submission);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('authenticates and authorizes before reading an activation body', async () => {
    let consumed = false;
    const { controlPlane, authorize } = fixture({ authorize: async () => false });

    const response = await controlPlane.handle(request({
      method: 'PUT',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: body(activationRequest(), () => { consumed = true; }),
      hasBody: true,
    }));

    expect(response.status).toBe(403);
    expect(parsed(response).error.code).toBe('HQ_CONTROL_FORBIDDEN');
    expect(authorize).toHaveBeenCalledWith({
      principal: 'operator',
      action: 'activate',
      target: TARGET,
      signal: undefined,
    });
    expect(consumed).toBe(false);
  });

  it('activates a release with compare-and-swap semantics', async () => {
    const record = activation(REVISION_TWO, REVISION_ONE);
    const activate = vi.fn(async () => ({ status: 'activated' as const, activation: record }));
    const { controlPlane } = fixture({ registry: { activate } });
    const encoded = activationRequest(REVISION_ONE);

    const response = await controlPlane.handle(request({
      method: 'PUT',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(encoded)),
      },
      body: body(encoded),
      hasBody: true,
    }));

    expect(response.status).toBe(201);
    expect(parsed(response)).toEqual({
      kind: 'hypequery-deployment-activation-response',
      version: 1,
      status: 'activated',
      activation: record,
    });
    expect(activate).toHaveBeenCalledWith({
      target: TARGET,
      releaseIdentity: RELEASE,
      expectedRevision: REVISION_ONE,
    });
  });

  it('notifies the host after durable activation without changing a successful response', async () => {
    const record = activation(REVISION_TWO, REVISION_ONE);
    const failure = new Error('host reconciliation failed');
    const onBackgroundError = vi.fn();
    const { controlPlane } = fixture({
      registry: {
        activate: async () => ({ status: 'activated', activation: record }),
      },
      onActivation: async () => { throw failure; },
      onBackgroundError,
    });

    const response = await controlPlane.handle(request({
      method: 'PUT',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: body(activationRequest(REVISION_ONE)),
      hasBody: true,
    }));

    expect(response.status).toBe(201);
    expect(parsed(response).activation).toEqual(record);
    await vi.waitFor(() => expect(onBackgroundError).toHaveBeenCalledWith(failure));
  });

  it('returns conflicts and already-active results without losing current state', async () => {
    const current = activation(REVISION_ONE);
    const conflict = fixture({
      registry: { activate: async () => ({ status: 'conflict', current }) },
    });
    const already = fixture({
      registry: { activate: async () => ({ status: 'already-active', activation: current }) },
    });
    const activationHttpRequest = () => request({
      method: 'PUT',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: body(activationRequest()),
      hasBody: true,
    });

    const conflictResponse = await conflict.controlPlane.handle(activationHttpRequest());
    const alreadyResponse = await already.controlPlane.handle(activationHttpRequest());

    expect(conflictResponse.status).toBe(409);
    expect(parsed(conflictResponse).current).toEqual(current);
    expect(alreadyResponse.status).toBe(200);
    expect(parsed(alreadyResponse).status).toBe('already-active');
  });

  it('reads current activation and bounded cursor history', async () => {
    const first = activation(REVISION_ONE);
    const second = activation(REVISION_TWO, REVISION_ONE);
    const historyPage = vi.fn(async (
      _target: typeof TARGET,
      query: { readonly limit: number; readonly before?: string },
    ) => query.before === undefined
      ? { activations: Object.freeze([second]), nextBefore: REVISION_TWO }
      : { activations: Object.freeze([first]), nextBefore: null });
    const { controlPlane, authorize } = fixture({
      registry: { current: async () => undefined, historyPage },
      limits: { maxHistoryPageSize: 1 },
    });

    const current = await controlPlane.handle(request());
    const newest = await controlPlane.handle(request({
      path: '/v1/deployments/targets/analytics/production/activations',
      query: {},
    }));
    const older = await controlPlane.handle(request({
      path: '/v1/deployments/targets/analytics/production/activations',
      query: { before: parsed(newest).nextBefore },
    }));

    expect(parsed(current).activation).toBeNull();
    expect(parsed(newest)).toMatchObject({ activations: [second], nextBefore: REVISION_TWO });
    expect(parsed(older)).toMatchObject({ activations: [first], nextBefore: null });
    expect(authorize.mock.calls.map(call => call[0].action)).toEqual([
      'read-current-activation',
      'read-activation-history',
      'read-activation-history',
    ]);
    expect(historyPage).toHaveBeenNthCalledWith(1, TARGET, { limit: 1 });
    expect(historyPage).toHaveBeenNthCalledWith(2, TARGET, {
      limit: 1,
      before: REVISION_TWO,
    });
  });

  it('rejects duplicate, unknown, and out-of-range history query parameters', async () => {
    const { controlPlane } = fixture({ limits: { maxHistoryPageSize: 2 } });
    const historyPath = '/v1/deployments/targets/analytics/production/activations';

    for (const query of [
      { limit: ['1', '2'] },
      { before: [REVISION_ONE, REVISION_TWO] },
      { limit: '3' },
      { unknown: 'value' },
      { __proto__: null, constructor: 'value' },
    ]) {
      const response = await controlPlane.handle(request({ path: historyPath, query }));
      expect(response.status).toBe(400);
      expect(parsed(response).error.code).toBe('HQ_CONTROL_BAD_REQUEST');
    }
  });

  it('maps a history cursor missing from storage to a bad request', async () => {
    const { controlPlane } = fixture({
      registry: {
        historyPage: async () => {
          throw new DeploymentActivationError(
            'HQ_DEPLOYMENT_ACTIVATION_INVALID_REQUEST',
            'cursor missing',
          );
        },
      },
    });

    const response = await controlPlane.handle(request({
      path: '/v1/deployments/targets/analytics/production/activations',
      query: { before: REVISION_ONE },
    }));

    expect(response.status).toBe(400);
    expect(parsed(response).error.code).toBe('HQ_CONTROL_BAD_REQUEST');
    expect(response.body).not.toContain('cursor missing');
  });

  it('rejects invalid activation bodies and enforces the configured byte limit', async () => {
    const { controlPlane } = fixture({ limits: { maxActivationRequestBytes: 512 } });
    const base = {
      method: 'PUT',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      hasBody: true,
    };

    const oversized = await controlPlane.handle(request({
      ...base,
      headers: { ...base.headers, 'content-length': '513' },
      body: body('x'.repeat(513)),
    }));
    const openShape = await controlPlane.handle(request({
      ...base,
      body: body(JSON.stringify({
        ...JSON.parse(activationRequest()),
        extra: true,
      })),
    }));

    expect(oversized.status).toBe(413);
    expect(parsed(oversized).error.code).toBe('HQ_CONTROL_TOO_LARGE');
    expect(openShape.status).toBe(400);
  });

  it('rejects bodies on read routes without consuming them', async () => {
    let consumed = false;
    const { controlPlane, authenticate } = fixture();
    const response = await controlPlane.handle(request({
      body: body('unexpected', () => { consumed = true; }),
      hasBody: true,
    }));

    expect(response.status).toBe(400);
    expect(consumed).toBe(false);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('maps activation storage errors to stable, non-leaking HTTP errors', async () => {
    const { controlPlane } = fixture({
      registry: {
        current: async () => {
          throw new DeploymentActivationError(
            'HQ_DEPLOYMENT_ACTIVATION_CORRUPT_STATE',
            'sensitive filesystem detail',
          );
        },
      },
    });

    const response = await controlPlane.handle(request());

    expect(response.status).toBe(500);
    expect(parsed(response)).toEqual({
      error: {
        code: 'HQ_CONTROL_INTERNAL',
        message: 'The deployment control-plane request could not be processed.',
      },
    });
    expect(response.body).not.toContain('filesystem');
  });

  it('does not expose custom registry details for expected release failures', async () => {
    const { controlPlane } = fixture({
      registry: {
        activate: async () => {
          throw new DeploymentActivationError(
            'HQ_DEPLOYMENT_ACTIVATION_RELEASE_NOT_FOUND',
            'sensitive provider detail',
          );
        },
      },
    });

    const response = await controlPlane.handle(request({
      method: 'PUT',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: body(activationRequest()),
      hasBody: true,
    }));

    expect(response.status).toBe(404);
    expect(parsed(response).error).toEqual({
      code: 'HQ_CONTROL_RELEASE_NOT_FOUND',
      message: 'The deployment release was not found.',
    });
    expect(response.body).not.toContain('provider');
  });

  it('returns strict route and method errors', async () => {
    const { controlPlane } = fixture();
    const unknown = await controlPlane.handle(request({
      path: '/v1/deployments/targets/%/production/unknown',
    }));
    const wrongMethod = await controlPlane.handle(request({ method: 'POST' }));

    expect(unknown.status).toBe(404);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.allow).toBe('GET, PUT');
  });
});

describe('deployment control-plane limits', () => {
  it('accepts explicit undefined overrides and rejects limits above the v1 maxima', () => {
    expect(resolveDeploymentControlPlaneLimits({
      maxActivationRequestBytes: undefined,
      maxHistoryPageSize: 25,
    })).toEqual({
      maxActivationRequestBytes:
        DEFAULT_DEPLOYMENT_CONTROL_PLANE_LIMITS.maxActivationRequestBytes,
      maxHistoryPageSize: 25,
    });
    expect(() => resolveDeploymentControlPlaneLimits({
      maxHistoryPageSize: DEFAULT_DEPLOYMENT_CONTROL_PLANE_LIMITS.maxHistoryPageSize + 1,
    })).toThrow(RangeError);
  });
});

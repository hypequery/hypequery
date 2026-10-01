import { beforeEach, describe, expect, it, vi } from 'vitest';

const output = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  indent: vi.fn(),
  newline: vi.fn(),
}));
vi.mock('../utils/logger.js', () => ({ logger: output }));

import { deploymentStatusCommand } from './deployment-status.js';

const target = { project: 'acme:analytics', environment: 'production' };
const credential = {
  cloudUrl: 'https://cloud.example.test',
  deploymentEndpoint: 'https://cloud.example.test/v1/deployments/submissions',
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  scope: 'deploy:submit',
  target,
  token: 'secret-deployment-token',
};
const endpoints = {
  active: true,
  rest: {
    baseUrl: 'https://orders-123.hypequery.app',
    datasets: [{ name: 'orders', url: 'https://orders-123.hypequery.app/api/analytics/datasets/orders/query' }],
  },
  mcp: { url: 'https://orders-123.hypequery.app/mcp' },
};
const live = {
  target,
  active: {
    revision: 'a'.repeat(64),
    releaseIdentity: 'b'.repeat(64),
    activatedAt: '2026-10-01T10:00:00.000Z',
    restored: false,
    hasSource: false,
  },
};

beforeEach(() => vi.clearAllMocks());

describe('deployment:status', () => {
  it('shows the selected live release and Cloud-provided customer URLs without a credential', async () => {
    const fetchLive = vi.fn(async () => live);
    const fetchEndpoints = vi.fn(async () => endpoints);
    await deploymentStatusCommand({ mcpConfig: true }, {
      env: {},
      loadCredential: async () => credential,
      fetchLive,
      fetchEndpoints,
    });

    expect(fetchLive).toHaveBeenCalledWith({
      endpoint: credential.deploymentEndpoint,
      token: credential.token,
      target,
      resource: 'state',
    });
    expect(fetchEndpoints).toHaveBeenCalledWith({
      endpoint: credential.deploymentEndpoint,
      token: credential.token,
      target,
    });
    const printed = JSON.stringify(output.info.mock.calls)
      + JSON.stringify(output.success.mock.calls)
      + JSON.stringify(output.indent.mock.calls);
    expect(printed).toContain('orders-123.hypequery.app/mcp');
    expect(printed).toContain('Live release');
    expect(printed).toContain('Bearer ${HYPEQUERY_API_KEY}');
    expect(printed).not.toContain(credential.token);
  });

  it('shows a reserved endpoint without suggesting it is already serving a release', async () => {
    await deploymentStatusCommand({}, {
      env: {},
      loadCredential: async () => credential,
      fetchLive: async () => ({ target, active: null }),
      fetchEndpoints: async () => ({ ...endpoints, active: false }),
    });

    expect(output.info).toHaveBeenCalledWith('No live release yet.');
    expect(output.info).toHaveBeenCalledWith(
      'These URLs will serve the target after a release is live.',
    );
    expect(JSON.stringify(output.indent.mock.calls)).not.toContain('self-test');
  });

  it('requires both target overrides when no stored target is available', async () => {
    const fetchLive = vi.fn();
    await expect(deploymentStatusCommand({ project: 'acme' }, {
      env: {},
      loadCredential: async () => credential,
      fetchLive,
    })).rejects.toThrow('Pass both --project and --environment');
    expect(fetchLive).not.toHaveBeenCalled();
  });

  it('accepts paired target overrides with an explicit deployment credential', async () => {
    const fetchLive = vi.fn(async () => live);
    await deploymentStatusCommand({
      endpoint: credential.deploymentEndpoint,
      project: target.project,
      environment: target.environment,
    }, {
      env: { HYPEQUERY_API_TOKEN: 'manual-token' },
      loadCredential: vi.fn(),
      fetchLive,
      fetchEndpoints: async () => undefined,
    });

    expect(fetchLive).toHaveBeenCalledWith(expect.objectContaining({
      token: 'manual-token',
      target,
      resource: 'state',
    }));
    expect(output.warn).toHaveBeenCalledWith('Cloud did not return hosted endpoint details.');
  });

  it('fails clearly when Cloud cannot return a live status response', async () => {
    await expect(deploymentStatusCommand({}, {
      env: {},
      loadCredential: async () => credential,
      fetchLive: async () => undefined,
    })).rejects.toThrow('Cloud did not return deployment status');
  });
});

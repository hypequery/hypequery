import { describe, expect, it, vi } from 'vitest';
import {
  fetchHostedEndpoints,
  mcpClientConfiguration,
  parseHostedEndpoints,
} from './hosted-endpoints.js';

const target = { project: 'project-1', environment: 'production' };
const SUBMISSIONS = 'https://cloud.example.test/v1/deployments/submissions';
const body = {
  kind: 'hypequery-hosted-endpoints',
  version: 1,
  target,
  active: true,
  rest: {
    baseUrl: 'https://cloud.example.test/api/gateway/project-1/production/execute',
    datasets: [{ name: 'orders', method: 'POST', url: 'https://cloud.example.test/api/gateway/project-1/production/execute/api/orders' }],
  },
  mcp: { url: 'https://cloud.example.test/api/gateway/project-1/production/mcp' },
  registry: { url: 'https://cloud.example.test/api/gateway/project-1/production/registry' },
};

describe('hosted endpoints', () => {
  it('asks Cloud beside the submissions endpoint, with the deployment credential', async () => {
    const fetch = vi.fn(async () => Response.json(body));

    const endpoints = await fetchHostedEndpoints({
      endpoint: SUBMISSIONS,
      token: 'secret-token',
      target,
      fetch: fetch as never,
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://cloud.example.test/v1/deployments/targets/project-1/production/endpoints',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
        redirect: 'error',
      }),
    );
    expect(endpoints?.mcp.url).toBe(body.mcp.url);
    expect(endpoints?.rest.datasets).toEqual([{ name: 'orders', url: body.rest.datasets[0]!.url }]);
  });

  // The deploy has already succeeded; nothing here may turn it into a failure.
  it.each([
    ['an older Cloud', () => new Response('not found', { status: 404 })],
    ['a server error', () => new Response('boom', { status: 500 })],
    ['an unexpected body', () => Response.json({ kind: 'something-else' })],
    ['invalid JSON', () => new Response('{', { status: 200 })],
    ['a network failure', () => { throw new TypeError('fetch failed'); }],
  ])('returns nothing for %s', async (_label, reply) => {
    await expect(fetchHostedEndpoints({
      endpoint: SUBMISSIONS,
      token: 'secret-token',
      target,
      fetch: vi.fn(async () => reply()) as never,
    })).resolves.toBeUndefined();
  });

  it('does not send the credential anywhere but a Cloud submissions endpoint over https', async () => {
    const fetch = vi.fn();

    for (const endpoint of [
      'https://deploy.example.test/v1/releases',
      'http://cloud.example.test/v1/deployments/submissions',
    ]) {
      await expect(fetchHostedEndpoints({ endpoint, token: 'secret-token', target, fetch }))
        .resolves.toBeUndefined();
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects endpoints that are not http URLs', () => {
    expect(parseHostedEndpoints({ ...body, mcp: { url: 'javascript:alert(1)' } })).toBeUndefined();
  });

  it('generates MCP configuration with a placeholder, never a key', () => {
    const config = JSON.parse(mcpClientConfiguration(body.mcp.url));

    expect(config).toEqual({
      mcpServers: {
        hypequery: {
          type: 'http',
          url: body.mcp.url,
          headers: { Authorization: 'Bearer ${HYPEQUERY_API_KEY}' },
        },
      },
    });
  });
});

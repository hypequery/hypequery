import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  validateProtocolDeploymentContract,
  type ProtocolDeploymentContract,
} from '@hypequery/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDeploymentDataPlaneFetchHandler,
  createDeploymentDataPlaneNodeHandler,
} from './data-plane-adapters.js';
import { createDeploymentDataPlane } from './data-plane.js';

const ARTIFACT = 'a'.repeat(64);
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => { if (error) reject(error); else resolve(); });
  })));
});

function deployment(): ProtocolDeploymentContract {
  return validateProtocolDeploymentContract({
    kind: 'hypequery-deployment',
    version: 1,
    datasets: [],
    queries: [{
      name: 'echo',
      input: { kind: 'any' },
      output: { kind: 'any' },
      implementation: {
        kind: 'runtime-reference',
        runtime: 'node',
        artifactSha256: ARTIFACT,
        entrypoint: 'queries.echo',
      },
      endpoint: {
        access: { kind: 'public' },
        tenant: { kind: 'not-required' },
        method: 'POST',
        path: '/echo',
        cacheTtlMs: 10_000,
      },
      tags: [],
    }],
    artifacts: [{ runtime: 'node', artifactSha256: ARTIFACT }],
  });
}

function dataPlane() {
  return createDeploymentDataPlane({
    deployment: deployment(),
    executeRuntimeReference: async ({ input }) => input,
  });
}

describe('deployment data-plane HTTP adapters', () => {
  it('maps Fetch query parameters and public cache metadata', async () => {
    const handler = createDeploymentDataPlaneFetchHandler(dataPlane());

    const response = await handler(new Request(
      'https://query.example/echo?state=paid&tag=a&tag=b&__proto__=safe',
      { method: 'POST' },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=10');
    expect(await response.json()).toEqual(JSON.parse(
      '{"state":"paid","tag":["a","b"],"__proto__":"safe"}',
    ));
  });

  it('rejects duplicate JSON names, mixed query/body input, and oversized bodies', async () => {
    const handler = createDeploymentDataPlaneFetchHandler(dataPlane(), { maxRequestBytes: 32 });
    const duplicate = await handler(new Request('https://query.example/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"state":"paid","state":"open"}',
    }));
    expect(duplicate.status).toBe(400);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: { code: 'HQ_DATA_PLANE_INPUT_INVALID' },
    });

    const mixed = await handler(new Request('https://query.example/echo?state=paid', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }));
    expect(mixed.status).toBe(400);

    const oversized = await handler(new Request('https://query.example/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 'x'.repeat(40) }),
    }));
    expect(oversized.status).toBe(413);
  });

  it('adapts Node requests and contains route errors', async () => {
    const handler = createDeploymentDataPlaneNodeHandler(dataPlane());
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'node' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ source: 'node' });

    const missing = await fetch(`http://127.0.0.1:${port}/missing`, { method: 'POST' });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: 'HQ_DATA_PLANE_ROUTE_NOT_FOUND' },
    });
  });
});

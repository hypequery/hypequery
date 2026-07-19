import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDeploymentControlPlaneFetchHandler,
  createDeploymentControlPlaneNodeHandler,
} from './control-plane-adapters.js';
import type { DeploymentControlPlane } from './control-plane.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => { if (error) reject(error); else resolve(); });
  })));
});

function success(body = '{"ok":true}\n') {
  return Object.freeze({
    status: 200,
    headers: Object.freeze({
      'content-type': 'application/json; charset=utf-8',
      'x-control-plane': 'true',
    }),
    body,
  });
}

describe('deployment control-plane HTTP adapters', () => {
  it('streams Fetch request bytes and preserves duplicate query parameters', async () => {
    let handlerStarted = false;
    let streamPulledBeforeHandler = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!handlerStarted) streamPulledBeforeHandler = true;
        controller.enqueue(Buffer.from('streamed-fetch-body'));
        controller.close();
      },
    });
    const handle = vi.fn<DeploymentControlPlane['handle']>(async request => {
      handlerStarted = true;
      const chunks: Uint8Array[] = [];
      for await (const chunk of request.body) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toBe('streamed-fetch-body');
      expect(request.query?.limit).toEqual(['1', '2']);
      expect(request.query?.__proto__).toBe('value');
      expect(request.hasBody).toBe(true);
      return success();
    });
    const fetchHandler = createDeploymentControlPlaneFetchHandler({ handle });
    const request = new Request('https://deploy.example/v1/test?limit=1&limit=2&__proto__=value', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    const response = await fetchHandler(request);

    expect(response.status).toBe(200);
    expect(response.headers.get('x-control-plane')).toBe('true');
    expect(await response.json()).toEqual({ ok: true });
    expect(handle).toHaveBeenCalledOnce();
    expect(streamPulledBeforeHandler).toBe(false);
  });

  it('streams Node request bytes and writes the exact control-plane response', async () => {
    const handle = vi.fn<DeploymentControlPlane['handle']>(async request => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of request.body) chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toBe('streamed-node-body');
      expect(request.path).toBe('/v1/test');
      expect(request.query).toEqual({ cursor: ['a', 'b'] });
      expect(request.hasBody).toBe(true);
      return success('{"transport":"node"}\n');
    });
    const server = createServer(createDeploymentControlPlaneNodeHandler({ handle }));
    servers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/v1/test?cursor=a&cursor=b`, {
      method: 'POST',
      body: 'streamed-node-body',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('x-control-plane')).toBe('true');
    expect(await response.json()).toEqual({ transport: 'node' });
    expect(handle).toHaveBeenCalledOnce();
  });

  it('preserves potential duplicate Fetch singleton headers for core rejection', async () => {
    const headers = new Headers();
    headers.append('authorization', 'Bearer first');
    headers.append('authorization', 'Bearer second');
    const handle = vi.fn<DeploymentControlPlane['handle']>(async request => {
      expect(Object.keys(request.headers).filter(name => (
        name.toLowerCase() === 'authorization'
      ))).toHaveLength(2);
      return success();
    });
    const fetchHandler = createDeploymentControlPlaneFetchHandler({ handle });

    const response = await fetchHandler(new Request('https://deploy.example/v1/test', {
      headers,
    }));

    expect(response.status).toBe(200);
    expect(handle).toHaveBeenCalledOnce();
  });

  it('contains unexpected adapter and custom-handler failures', async () => {
    const fetchHandler = createDeploymentControlPlaneFetchHandler({
      handle: async () => { throw new Error('sensitive fetch failure'); },
    });
    const response = await fetchHandler(new Request('https://deploy.example/v1/test'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: {
        code: 'HQ_CONTROL_INTERNAL',
        message: 'The deployment control-plane request could not be processed.',
      },
    });
  });
});

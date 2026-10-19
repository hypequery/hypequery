import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { deliverBatch } from './delivery.js';
import { postJson, type PostJson } from './post-json.js';

const url = new URL('https://telemetry.example/batch');

describe('detached batch delivery', () => {
  it('posts once and never retries HTTP failures', async () => {
    for (const status of [204, 400, 429, 500, 503]) {
      const post = vi.fn<PostJson>().mockResolvedValue(status);
      const onDisabled = vi.fn(async () => undefined);
      await expect(deliverBatch(url, '{"batch":[]}', { post, onDisabled })).resolves.toBeUndefined();
      expect(post).toHaveBeenCalledTimes(1);
      expect(post.mock.calls[0].slice(0, 2)).toEqual([url, '{"batch":[]}']);
      expect(onDisabled).not.toHaveBeenCalled();
    }
  });
  it('swallows thrown and rejected failures', async () => {
    for (const post of [() => { throw new Error('private'); }, () => Promise.reject(new Error('private'))] as PostJson[]) {
      await expect(deliverBatch(url, '{}', { post })).resolves.toBeUndefined();
    }
  });
  it('posts JSON over node:http and never follows redirects', async () => {
    const hits: string[] = [];
    let received = '';
    const server = createServer((request, response) => {
      hits.push(request.url ?? '');
      request.setEncoding('utf8');
      request.on('data', chunk => { received += chunk; });
      request.on('end', () => {
        response.writeHead(request.url === '/batch' ? 307 : 204, { location: '/elsewhere' });
        response.end();
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    try {
      const status = await postJson(new URL(`http://127.0.0.1:${port}/batch`), '{"batch":[]}', new AbortController().signal);
      expect(status).toBe(307);
      expect(hits).toEqual(['/batch']);
      expect(received).toBe('{"batch":[]}');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it('hard-caps a real blackholed HTTP request and aborts its socket', async () => {
    const server = createServer(() => { /* Deliberately leave the response open. */ });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const started = performance.now();
    try {
      await deliverBatch(new URL(`http://127.0.0.1:${port}/batch`), '{}', { timeoutMs: 50 });
      expect(performance.now() - started).toBeLessThan(50 + 75);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it('honors 410 and swallows a failed kill-switch write', async () => {
    const onDisabled = vi.fn(async () => { throw new Error('read-only'); });
    await expect(deliverBatch(url, '{}', { post: async () => 410, onDisabled })).resolves.toBeUndefined();
    expect(onDisabled).toHaveBeenCalledTimes(1);
  });
  it('ignores a 410 returned after the deadline even when the request ignores abort', async () => {
    vi.useFakeTimers();
    try {
      const onDisabled = vi.fn(async () => undefined);
      const delivery = deliverBatch(url, '{}', { timeoutMs: 100, onDisabled,
        post: () => new Promise(resolve => setTimeout(() => resolve(410), 101)) });
      await vi.advanceTimersByTimeAsync(100);
      await delivery;
      await vi.advanceTimersByTimeAsync(1);
      expect(onDisabled).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

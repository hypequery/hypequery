import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { completed } from '../../../type-tests/fixtures.js';
import { FLUSH_TIMEOUT_MS, MAX_BATCH_BYTES, MAX_BATCH_EVENTS, TelemetryTransport } from './transport.js';
import { postJson, type PostJson } from './post-json.js';

describe('bounded telemetry transport', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('sends a single bounded batch, without person profiles, IP enrichment or retries', async () => {
    const post = vi.fn<PostJson>().mockResolvedValue(204);
    const transport = new TelemetryTransport({ enabled: true, endpoint: 'https://telemetry.example/batch', post });
    for (let index = 0; index < 50; index++) transport.enqueue(completed);
    await Promise.all([transport.flush(), transport.flush()]);
    expect(post).toHaveBeenCalledTimes(1);
    const [url, body] = post.mock.calls[0];
    expect(url.href).toBe('https://telemetry.example/batch');
    const payload = JSON.parse(body);
    expect(payload.batch).toHaveLength(MAX_BATCH_EVENTS);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
    expect(payload.batch[0]).toMatchObject({ distinct_id: completed.properties.install_id, properties: { $process_person_profile: false, $geoip_disable: true } });
  });
  it('debug prints the exact event envelopes to stderr instead of sending', async () => {
    const write = vi.fn();
    const post = vi.fn<PostJson>();
    const now = () => new Date('2026-10-06T10:00:00Z');
    const transport = new TelemetryTransport({ enabled: true, debug: true, endpoint: 'https://telemetry.example', post, write, now });
    transport.enqueue(completed);
    transport.enqueue({ ...completed, path: '/private/secret' });
    await transport.flush();
    expect(post).not.toHaveBeenCalled();
    const event = JSON.parse(write.mock.calls.find(([text]) => text.startsWith('{'))![0]);
    expect(event.timestamp).toBe(now().toISOString());
    expect(event.properties.$geoip_disable).toBe(true);
    expect(write.mock.calls.flat().join('')).not.toContain('private');
  });
  it.each([400, 429, 500, 503])('ignores HTTP %s without retrying', async status => {
    const post = vi.fn<PostJson>().mockResolvedValue(status);
    const transport = new TelemetryTransport({ enabled: true, endpoint: 'https://telemetry.example', post });
    transport.enqueue(completed);
    await expect(transport.flush()).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledTimes(1);
  });
  it('handles thrown and rejected failures and invalid endpoints', async () => {
    for (const endpoint of ['file:///private', 'http://remote.example', 'https://user:secret@host', 'https://host/?secret', 'https://host/#secret']) {
      const post = vi.fn<PostJson>();
      const transport = new TelemetryTransport({ enabled: true, endpoint, post });
      transport.enqueue(completed);
      await transport.flush();
      expect(post).not.toHaveBeenCalled();
    }
    for (const post of [() => { throw new Error('private'); }, () => Promise.reject(new Error('private'))] as PostJson[]) {
      const transport = new TelemetryTransport({ enabled: true, endpoint: 'https://telemetry.example', post });
      transport.enqueue(completed);
      await expect(transport.flush()).resolves.toBeUndefined();
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
    const address = server.address() as { port: number };
    const transport = new TelemetryTransport({ enabled: true, endpoint: `http://127.0.0.1:${address.port}/batch` });
    transport.enqueue(completed);
    const started = performance.now();
    try {
      await transport.flush();
      expect(performance.now() - started).toBeLessThan(FLUSH_TIMEOUT_MS + 75);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it('honors 410 and swallows a failed kill-switch write', async () => {
    const onDisabled = vi.fn(async () => { throw new Error('read-only'); });
    const transport = new TelemetryTransport({ enabled: true, endpoint: 'https://telemetry.example', post: async () => 410, onDisabled });
    transport.enqueue(completed);
    await expect(transport.flush()).resolves.toBeUndefined();
    expect(onDisabled).toHaveBeenCalledTimes(1);
  });
  it('disabled transport cannot print or send', async () => {
    const post = vi.fn<PostJson>();
    const write = vi.fn();
    const transport = new TelemetryTransport({ enabled: false, debug: true, endpoint: 'https://telemetry.example', post, write });
    transport.enqueue(completed);
    await transport.flush();
    expect(post).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
  it('ignores a 410 returned after the deadline even when the request ignores abort', async () => {
    vi.useFakeTimers();
    try {
      const onDisabled = vi.fn(async () => undefined);
      const transport = new TelemetryTransport({ enabled: true, endpoint: 'https://telemetry.example',
        post: () => new Promise(resolve => setTimeout(() => resolve(410), FLUSH_TIMEOUT_MS + 1)), onDisabled });
      transport.enqueue(completed);
      const flush = transport.flush();
      await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS);
      await flush;
      await vi.advanceTimersByTimeAsync(1);
      expect(onDisabled).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

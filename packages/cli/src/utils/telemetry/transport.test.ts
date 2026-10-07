import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { completed } from '../../../type-tests/fixtures.js';
import { FLUSH_TIMEOUT_MS, MAX_BATCH_BYTES, MAX_BATCH_EVENTS, TelemetryTransport } from './transport.js';

describe('bounded telemetry transport', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('sends a single bounded batch, without person profiles, IP enrichment or retries', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const transport = new TelemetryTransport({ enabled: true, endpoint: 'https://telemetry.example/batch', fetch });
    for (let index = 0; index < 50; index++) transport.enqueue(completed);
    await Promise.all([transport.flush(), transport.flush()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = fetch.mock.calls[0][1]!;
    const payload = JSON.parse(request.body as string);
    expect(payload.batch).toHaveLength(MAX_BATCH_EVENTS);
    expect(Buffer.byteLength(request.body as string)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
    expect(payload.batch[0]).toMatchObject({ distinct_id: completed.properties.install_id, properties: { $process_person_profile: false, $geoip_disable: true } });
    expect(request.redirect).toBe('error');
  });
  it('debug prints the exact event envelopes to stderr instead of sending', async () => {
    const write = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>();
    const now = () => new Date('2026-10-06T10:00:00Z');
    const transport = new TelemetryTransport({ enabled: true, debug: true, endpoint: 'https://telemetry.example', fetch, write, now });
    transport.enqueue(completed);
    transport.enqueue({ ...completed, path: '/private/secret' });
    await transport.flush();
    expect(fetch).not.toHaveBeenCalled();
    const event = JSON.parse(write.mock.calls.find(([text]) => text.startsWith('{'))![0]);
    expect(event.timestamp).toBe(now().toISOString());
    expect(event.properties.$geoip_disable).toBe(true);
    expect(write.mock.calls.flat().join('')).not.toContain('private');
  });
  it.each([400, 429, 500, 503])('ignores HTTP %s without retrying', async status => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, { status }));
    const transport = new TelemetryTransport({ enabled: true, endpoint: 'https://telemetry.example', fetch });
    transport.enqueue(completed);
    await expect(transport.flush()).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('handles unavailable fetch, thrown failures and invalid endpoints', async () => {
    for (const endpoint of ['file:///private', 'http://remote.example', 'https://user:secret@host', 'https://host/?secret', 'https://host/#secret']) {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const transport = new TelemetryTransport({ enabled: true, endpoint, fetch });
      transport.enqueue(completed);
      await transport.flush();
      expect(fetch).not.toHaveBeenCalled();
    }
    vi.stubGlobal('fetch', undefined);
    const absent = new TelemetryTransport({ enabled: true, endpoint: 'https://telemetry.example' });
    absent.enqueue(completed);
    await expect(absent.flush()).resolves.toBeUndefined();
    vi.unstubAllGlobals();
    const throwing = new TelemetryTransport({ enabled: true, endpoint: 'https://telemetry.example', fetch: () => { throw new Error('private'); } });
    throwing.enqueue(completed);
    await expect(throwing.flush()).resolves.toBeUndefined();
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
    const transport = new TelemetryTransport({ enabled: true, endpoint: 'https://telemetry.example', fetch: async () => new Response(null, { status: 410 }), onDisabled });
    transport.enqueue(completed);
    await expect(transport.flush()).resolves.toBeUndefined();
    expect(onDisabled).toHaveBeenCalledTimes(1);
  });
  it('disabled transport cannot print or send', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const write = vi.fn();
    const transport = new TelemetryTransport({ enabled: false, debug: true, endpoint: 'https://telemetry.example', fetch, write });
    transport.enqueue(completed);
    await transport.flush();
    expect(fetch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

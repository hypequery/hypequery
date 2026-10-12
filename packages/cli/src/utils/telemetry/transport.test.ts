import { afterEach, describe, expect, it, vi } from 'vitest';
import { completed } from '../../../type-tests/fixtures.js';
import { MAX_BATCH_BYTES, MAX_BATCH_EVENTS, TelemetryTransport } from './transport.js';
import type { DispatchBatch } from './detached-dispatch.js';

describe('bounded telemetry transport', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('dispatches a single bounded batch, without person profiles, IP enrichment or retries', async () => {
    const dispatch = vi.fn<DispatchBatch>();
    const transport = new TelemetryTransport({ enabled: true, endpoint: 'https://telemetry.example/batch', dispatch });
    for (let index = 0; index < 50; index++) transport.enqueue(completed);
    await Promise.all([transport.flush(), transport.flush()]);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [url, body] = dispatch.mock.calls[0];
    expect(url.href).toBe('https://telemetry.example/batch');
    const payload = JSON.parse(body);
    expect(payload.api_key).toBe('hypequery-cli');
    expect(payload.batch).toHaveLength(MAX_BATCH_EVENTS);
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(MAX_BATCH_BYTES);
    expect(payload.batch[0]).toMatchObject({ distinct_id: completed.properties.install_id, properties: { $process_person_profile: false, $geoip_disable: true } });
  });
  it('debug prints the exact event envelopes to stderr instead of sending', async () => {
    const write = vi.fn();
    const dispatch = vi.fn<DispatchBatch>();
    const now = () => new Date('2026-10-06T10:00:00Z');
    const transport = new TelemetryTransport({ enabled: true, debug: true, endpoint: 'https://telemetry.example', dispatch, write, now });
    transport.enqueue(completed);
    transport.enqueue({ ...completed, path: '/private/secret' });
    await transport.flush();
    expect(dispatch).not.toHaveBeenCalled();
    const event = JSON.parse(write.mock.calls.find(([text]) => text.startsWith('{'))![0]);
    expect(event.timestamp).toBe(now().toISOString());
    expect(event.properties.$geoip_disable).toBe(true);
    expect(write.mock.calls.flat().join('')).not.toContain('private');
  });
  it('rejects invalid endpoints and swallows dispatch failures', async () => {
    for (const endpoint of [undefined, 'file:///private', 'http://remote.example', 'https://user:secret@host', 'https://host/?secret', 'https://host/#secret']) {
      const dispatch = vi.fn<DispatchBatch>();
      const transport = new TelemetryTransport({ enabled: true, endpoint, dispatch });
      transport.enqueue(completed);
      await transport.flush();
      expect(dispatch).not.toHaveBeenCalled();
    }
    for (const endpoint of ['http://localhost:4000/batch', 'http://127.0.0.1/batch', 'http://[::1]/batch']) {
      const dispatch = vi.fn<DispatchBatch>();
      const transport = new TelemetryTransport({ enabled: true, endpoint, dispatch });
      transport.enqueue(completed);
      await transport.flush();
      expect(dispatch).toHaveBeenCalledTimes(1);
    }
    const transport = new TelemetryTransport({ enabled: true, endpoint: 'https://telemetry.example', dispatch: () => { throw new Error('private'); } });
    transport.enqueue(completed);
    await expect(transport.flush()).resolves.toBeUndefined();
  });
  it('disabled transport cannot print or send', async () => {
    const dispatch = vi.fn<DispatchBatch>();
    const write = vi.fn();
    const transport = new TelemetryTransport({ enabled: false, debug: true, endpoint: 'https://telemetry.example', dispatch, write });
    transport.enqueue(completed);
    await transport.flush();
    expect(dispatch).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});

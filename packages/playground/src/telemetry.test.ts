import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Telemetry, anonymize, durationBucket, UI_EVENT_ALLOWLIST } from './telemetry.js';

const ENDPOINT = 'http://127.0.0.1:9/ingest';

function makeFetch() {
  return vi.fn(async () => new Response(null, { status: 204 }));
}

describe('Telemetry', () => {
  const envKeys = ['HYPEQUERY_TELEMETRY_DISABLED', 'DO_NOT_TRACK', 'CI', 'HYPEQUERY_TELEMETRY_ENDPOINT'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('is disabled when no endpoint is configured', () => {
    const t = new Telemetry({ fetchFn: makeFetch() });
    expect(t.enabled).toBe(false);
  });

  it('is enabled with an endpoint and no opt-out signals', () => {
    const t = new Telemetry({ endpoint: ENDPOINT, fetchFn: makeFetch() });
    expect(t.enabled).toBe(true);
  });

  it.each([
    ['HYPEQUERY_TELEMETRY_DISABLED'],
    ['DO_NOT_TRACK'],
    ['CI'],
  ])('kill switch: %s=1 disables telemetry', (key) => {
    process.env[key] = '1';
    const t = new Telemetry({ endpoint: ENDPOINT, fetchFn: makeFetch() });
    expect(t.enabled).toBe(false);
  });

  it('track + flush posts a batch with anonymous ids only', async () => {
    const fetchFn = makeFetch();
    const t = new Telemetry({ endpoint: ENDPOINT, fetchFn, projectDir: '/Users/someone/secret-project' });
    t.track('gateway_started', { capabilities: 'registry,execute' });
    await t.flush();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchFn.mock.calls[0] as any)[1].body as string);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].name).toBe('gateway_started');
    // Project path must never appear anywhere in the payload
    expect(JSON.stringify(body)).not.toContain('secret-project');
    expect(body.projectId).toMatch(/^[0-9a-f]{12}$/);
  });

  it('tracks nothing when disabled', async () => {
    const fetchFn = makeFetch();
    const t = new Telemetry({ fetchFn }); // no endpoint
    t.track('gateway_started');
    await t.flush();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('swallows network failures', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    });
    const t = new Telemetry({ endpoint: ENDPOINT, fetchFn: fetchFn as unknown as typeof fetch });
    t.track('gateway_started');
    await expect(t.flush()).resolves.toBeUndefined();
  });

  it('anonymize produces a stable 12-char hash', () => {
    expect(anonymize('myQuery')).toBe(anonymize('myQuery'));
    expect(anonymize('myQuery')).toMatch(/^[0-9a-f]{12}$/);
    expect(anonymize('myQuery')).not.toContain('myQuery');
  });

  it('durationBucket never leaks exact timings', () => {
    expect(durationBucket(3)).toBe('<50ms');
    expect(durationBucket(999)).toBe('<1s');
    expect(durationBucket(120_000)).toBe('>=30s');
  });

  it('UI allowlist stays free of anything payload-shaped', () => {
    for (const name of UI_EVENT_ALLOWLIST) {
      expect(name).toMatch(/^[a-z_]+$/);
    }
  });
});

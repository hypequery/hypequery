import { describe, expect, it, vi } from 'vitest';

import {
  DEVICE_CODE_GRANT_TYPE,
  pollDeviceAuthorization,
  startDeviceAuthorization,
  type DeviceAuthorization,
} from './device-sign-in.js';

const ORIGIN = 'https://cloud.example.test';
const DEVICE_CODE = `hqdc_v1_${'d'.repeat(43)}`;
const MANAGEMENT_TOKEN = `hqmt_v1_${'m'.repeat(43)}`;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A clock that only moves when the flow sleeps. */
function clock(start = Date.parse('2030-01-01T00:00:00.000Z')) {
  let now = start;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: vi.fn(async (milliseconds: number) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    }),
    sleeps,
  };
}

function codeResponse(overrides: Record<string, unknown> = {}) {
  return {
    device_code: DEVICE_CODE,
    user_code: 'BCDF-GHJK',
    verification_uri: `${ORIGIN}/cli/device`,
    verification_uri_complete: `${ORIGIN}/cli/device?code=BCDF-GHJK`,
    expires_in: 600,
    interval: 5,
    ...overrides,
  };
}

function authorization(time: ReturnType<typeof clock>, overrides: Partial<DeviceAuthorization> = {}): DeviceAuthorization {
  return {
    deviceCode: DEVICE_CODE,
    userCode: 'BCDF-GHJK',
    verificationUri: `${ORIGIN}/cli/device`,
    expiresAt: time.now() + 600_000,
    interval: 5,
    ...overrides,
  };
}

/** A stub token endpoint that answers each poll in turn. */
function tokenEndpoint(...responses: Array<() => Response | Promise<Response>>) {
  const bodies: unknown[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toBe(`${ORIGIN}/api/cli/device/token`);
    bodies.push(JSON.parse(String(init?.body)));
    const next = responses.shift();
    if (!next) throw new Error('polled more often than expected');
    return next();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls: fetch, bodies };
}

describe('startDeviceAuthorization', () => {
  it('sends the project limit and capability cap and reads the RFC 8628 response', async () => {
    const time = clock();
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`${ORIGIN}/api/cli/device/code`);
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({
        client_id: 'hypequery-cli',
        project: 'shop',
        capabilities: ['workspace:view', 'deployment:publish'],
      });
      return json(200, codeResponse());
    });
    await expect(startDeviceAuthorization({
      origin: ORIGIN,
      project: 'shop',
      capabilities: ['workspace:view', 'deployment:publish'],
    }, { fetch: fetch as unknown as typeof globalThis.fetch, now: time.now })).resolves.toEqual({
      deviceCode: DEVICE_CODE,
      userCode: 'BCDF-GHJK',
      verificationUri: `${ORIGIN}/cli/device`,
      verificationUriComplete: `${ORIGIN}/cli/device?code=BCDF-GHJK`,
      expiresAt: time.now() + 600_000,
      interval: 5,
    });
  });

  it('refuses a verification URL on another origin', async () => {
    const fetch = vi.fn(async () => json(200, codeResponse({ verification_uri: 'https://phish.example.test/cli/device' })));
    await expect(startDeviceAuthorization({ origin: ORIGIN }, { fetch: fetch as unknown as typeof globalThis.fetch }))
      .rejects.toThrow(/invalid device sign-in response/);
  });

  it('says when this Cloud has no device sign-in', async () => {
    const fetch = vi.fn(async () => new Response('Not found', { status: 404 }));
    await expect(startDeviceAuthorization({ origin: ORIGIN }, { fetch: fetch as unknown as typeof globalThis.fetch }))
      .rejects.toMatchObject({ code: 'CLOUD_DEVICE_SIGN_IN_UNSUPPORTED' });
  });

  it('relays an unknown capability as something to correct', async () => {
    const fetch = vi.fn(async () => json(400, { error: 'invalid_scope', error_description: 'Unknown capability "x:y".' }));
    await expect(startDeviceAuthorization({ origin: ORIGIN, capabilities: ['x:y'] }, { fetch: fetch as unknown as typeof globalThis.fetch }))
      .rejects.toMatchObject({ code: 'CLOUD_DEVICE_SIGN_IN_REFUSED', exitClass: 'correctable', message: expect.stringContaining('Unknown capability') });
  });

  it('treats a start rate limit as transient', async () => {
    const fetch = vi.fn(async () => json(429, { error: 'slow_down' }));
    await expect(startDeviceAuthorization({ origin: ORIGIN }, { fetch: fetch as unknown as typeof globalThis.fetch }))
      .rejects.toMatchObject({ exitClass: 'transient', retryable: true });
  });

  it('reports an unreachable Cloud as transient', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(startDeviceAuthorization({ origin: ORIGIN }, { fetch: fetch as unknown as typeof globalThis.fetch }))
      .rejects.toMatchObject({ code: 'CLOUD_UNREACHABLE', exitClass: 'transient' });
  });
});

describe('pollDeviceAuthorization', () => {
  it('waits the interval, slows down when told, and returns the token response', async () => {
    const time = clock();
    const success = { access_token: MANAGEMENT_TOKEN, management_token: MANAGEMENT_TOKEN, token_type: 'Bearer' };
    const endpoint = tokenEndpoint(
      () => json(400, { error: 'authorization_pending', interval: 5 }),
      () => json(400, { error: 'slow_down', interval: 10 }),
      () => json(400, { error: 'authorization_pending', interval: 10 }),
      () => json(200, success),
    );
    await expect(pollDeviceAuthorization(ORIGIN, authorization(time), {
      fetch: endpoint.fetch,
      now: time.now,
      sleep: time.sleep,
    })).resolves.toEqual(success);
    expect(time.sleeps).toEqual([5_000, 5_000, 10_000, 10_000]);
    expect(endpoint.bodies[0]).toEqual({
      grant_type: DEVICE_CODE_GRANT_TYPE,
      device_code: DEVICE_CODE,
      client_id: 'hypequery-cli',
    });
  });

  it('adds five seconds on slow_down when Cloud names no interval', async () => {
    const time = clock();
    const endpoint = tokenEndpoint(
      () => json(400, { error: 'slow_down' }),
      () => json(200, { management_token: MANAGEMENT_TOKEN }),
    );
    await pollDeviceAuthorization(ORIGIN, authorization(time), { fetch: endpoint.fetch, now: time.now, sleep: time.sleep });
    expect(time.sleeps).toEqual([5_000, 10_000]);
  });

  it('stops when Cloud says the code expired', async () => {
    const time = clock();
    const endpoint = tokenEndpoint(() => json(400, { error: 'expired_token' }));
    await expect(pollDeviceAuthorization(ORIGIN, authorization(time), { fetch: endpoint.fetch, now: time.now, sleep: time.sleep }))
      .rejects.toMatchObject({ code: 'CLOUD_AUTHORIZATION_TIMED_OUT', exitClass: 'auth' });
  });

  it('stops polling on its own once the code has expired', async () => {
    const time = clock();
    const endpoint = tokenEndpoint(
      () => json(400, { error: 'authorization_pending' }),
      () => json(400, { error: 'authorization_pending' }),
    );
    await expect(pollDeviceAuthorization(ORIGIN, authorization(time, { expiresAt: time.now() + 10_000 }), {
      fetch: endpoint.fetch,
      now: time.now,
      sleep: time.sleep,
    })).rejects.toMatchObject({ code: 'CLOUD_AUTHORIZATION_TIMED_OUT' });
    expect(endpoint.calls).toHaveBeenCalledTimes(2);
  });

  it('reports a denied sign-in as an auth failure', async () => {
    const time = clock();
    const endpoint = tokenEndpoint(() => json(400, { error: 'access_denied', error_description: 'The sign-in was denied.' }));
    await expect(pollDeviceAuthorization(ORIGIN, authorization(time), { fetch: endpoint.fetch, now: time.now, sleep: time.sleep }))
      .rejects.toMatchObject({ code: 'CLOUD_AUTHORIZATION_DECLINED', exitClass: 'auth', message: expect.stringContaining('denied') });
  });

  it('keeps polling through brief network failures, then gives up', async () => {
    const time = clock();
    const down = () => {
      throw new TypeError('fetch failed');
    };
    const recovered = tokenEndpoint(down, () => json(503, {}), () => json(200, { management_token: MANAGEMENT_TOKEN }));
    await expect(pollDeviceAuthorization(ORIGIN, authorization(time), { fetch: recovered.fetch, now: time.now, sleep: time.sleep }))
      .resolves.toEqual({ management_token: MANAGEMENT_TOKEN });

    const outage = tokenEndpoint(down, down, down);
    await expect(pollDeviceAuthorization(ORIGIN, authorization(time), { fetch: outage.fetch, now: time.now, sleep: time.sleep }))
      .rejects.toMatchObject({ code: 'CLOUD_UNREACHABLE', exitClass: 'transient' });
  });
});

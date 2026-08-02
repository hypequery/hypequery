import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { fetchLiveDeployment } from './live-deployment.js';

const target = { project: 'acme:analytics', environment: 'production' };
const bytes = Buffer.from('export const answer = 42;\n');
const sha256 = createHash('sha256').update(bytes).digest('hex');

function response(contentsBase64 = bytes.toString('base64')) {
  return {
    kind: 'hypequery-live-deployment',
    version: 1,
    target,
    active: {
      revision: 'a'.repeat(64),
      releaseIdentity: 'b'.repeat(64),
      activatedAt: '2026-08-01T10:00:00.000Z',
      restored: false,
      hasSource: true,
      source: {
        entrypoint: 'analytics/api.ts',
        files: [{
          path: 'analytics/api.ts',
          sha256,
          byteLength: bytes.byteLength,
          contentsBase64,
        }],
      },
    },
  };
}

describe('live deployment client', () => {
  it('requests and verifies the target source snapshot', async () => {
    const fetchMock = vi.fn(async () => Response.json(response()));

    const live = await fetchLiveDeployment({
      endpoint: 'https://cloud.example.test/v1/deployments/submissions',
      token: 'secret-token',
      target,
      resource: 'source',
      fetch: fetchMock as typeof fetch,
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://cloud.example.test/v1/deployments/targets/acme%3Aanalytics/production/source',
    );
    expect(live?.active?.source?.files[0]?.bytes).toEqual(bytes);
  });

  it('rejects source bytes that do not match their digest', async () => {
    await expect(fetchLiveDeployment({
      endpoint: 'https://cloud.example.test/v1/deployments/submissions',
      token: 'secret-token',
      target,
      resource: 'source',
      fetch: (async () => Response.json(
        response(Buffer.from('changed').toString('base64')),
      )) as typeof fetch,
    })).rejects.toThrow('corrupt');
  });

  it('treats a missing state route as an older provider', async () => {
    await expect(fetchLiveDeployment({
      endpoint: 'https://cloud.example.test/v1/deployments/submissions',
      token: 'secret-token',
      target,
      resource: 'state',
      fetch: (async () => new Response(null, { status: 404 })) as typeof fetch,
    })).resolves.toBeUndefined();
  });

  it('does not call non-Cloud submission providers for live state', async () => {
    const fetchMock = vi.fn();

    await expect(fetchLiveDeployment({
      endpoint: 'https://provider.example.test/v1/releases',
      token: 'secret-token',
      target,
      resource: 'state',
      fetch: fetchMock as typeof fetch,
    })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects unsafe Cloud endpoints before sending the credential', async () => {
    const fetchMock = vi.fn();

    await expect(fetchLiveDeployment({
      endpoint: 'http://cloud.example.test/v1/deployments/submissions',
      token: 'secret-token',
      target,
      resource: 'state',
      fetch: fetchMock as typeof fetch,
    })).rejects.toThrow('safely');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

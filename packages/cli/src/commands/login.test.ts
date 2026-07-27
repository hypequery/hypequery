import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  },
}));

import { loginCommand, logoutCommand } from './login.js';

describe('Cloud CLI authentication', () => {
  it('completes a browser loopback PKCE flow and stores the returned token', async () => {
    let authorizeUrl: URL | undefined;
    const saveCredential = vi.fn();
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        code_verifier: string;
        redirect_uri: string;
      };
      expect(
        createHash('sha256').update(body.code_verifier).digest('base64url'),
      ).toBe(authorizeUrl?.searchParams.get('code_challenge'));
      expect(body.redirect_uri).toBe(authorizeUrl?.searchParams.get('redirect_uri'));
      return new Response(JSON.stringify({
        access_token: `hqdp_v1_${'c'.repeat(43)}`,
        token_type: 'Bearer',
        expires_at: '2030-01-01T00:00:00.000Z',
        scope: 'deploy:submit',
        deployment_endpoint:
          'https://cloud.example.test/v1/deployments/submissions',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const openBrowser = vi.fn(async (input: string) => {
      authorizeUrl = new URL(input);
      const callback = new URL(
        authorizeUrl.searchParams.get('redirect_uri') as string,
      );
      callback.searchParams.set('code', `hqac_v1_${'d'.repeat(43)}`);
      callback.searchParams.set(
        'state',
        authorizeUrl.searchParams.get('state') as string,
      );
      await fetch(callback);
    });

    await loginCommand({ cloudUrl: 'https://cloud.example.test' }, {
      fetch: fetchMock as typeof fetch,
      openBrowser,
      saveCredential,
      timeoutMs: 2_000,
    });

    expect(openBrowser).toHaveBeenCalledOnce();
    expect(saveCredential).toHaveBeenCalledWith({
      cloudUrl: 'https://cloud.example.test',
      deploymentEndpoint:
        'https://cloud.example.test/v1/deployments/submissions',
      expiresAt: '2030-01-01T00:00:00.000Z',
      scope: 'deploy:submit',
      token: `hqdp_v1_${'c'.repeat(43)}`,
    });
  });

  it('revokes the remote token before deleting it locally', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const deleteCredential = vi.fn();
    await logoutCommand({
      fetch: fetchMock as typeof fetch,
      loadCredential: async () => ({
        cloudUrl: 'https://cloud.example.test',
        deploymentEndpoint:
          'https://cloud.example.test/v1/deployments/submissions',
        expiresAt: '2030-01-01T00:00:00.000Z',
        scope: 'deploy:submit',
        token: `hqdp_v1_${'e'.repeat(43)}`,
      }),
      deleteCredential,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://cloud.example.test/api/cli/token'),
      expect.objectContaining({
        method: 'DELETE',
        headers: { Authorization: `Bearer hqdp_v1_${'e'.repeat(43)}` },
      }),
    );
    expect(deleteCredential).toHaveBeenCalledOnce();
  });
});

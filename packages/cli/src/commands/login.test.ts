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

const TOKEN_RESPONSE_NOW = Date.parse('2029-12-31T12:00:00.000Z');

function authorizeInBrowser(input: string) {
  const authorizeUrl = new URL(input);
  const callback = new URL(
    authorizeUrl.searchParams.get('redirect_uri') as string,
  );
  callback.searchParams.set('code', `hqac_v1_${'d'.repeat(43)}`);
  callback.searchParams.set(
    'state',
    authorizeUrl.searchParams.get('state') as string,
  );
  return fetch(callback);
}

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
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({
        access_token: `hqdp_v1_${'c'.repeat(43)}`,
        token_type: 'Bearer',
        expires_at: '2030-01-01T00:00:00.000Z',
        scope: 'deploy:submit',
        deployment_endpoint:
          'https://cloud.example.test/v1/deployments/submissions',
        deployment_target: {
          project: 'acme:analytics',
          environment: 'production',
        },
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
      const invalidCallback = new URL(callback);
      invalidCallback.searchParams.set('code', `hqac_v1_${'d'.repeat(43)}`);
      await expect(fetch(invalidCallback)).resolves.toMatchObject({ status: 400 });
      callback.searchParams.set('code', `hqac_v1_${'d'.repeat(43)}`);
      callback.searchParams.set(
        'state',
        authorizeUrl.searchParams.get('state') as string,
      );
      await fetch(callback);
    });

    await loginCommand({ cloudUrl: 'https://cloud.example.test' }, {
      fetch: fetchMock as typeof fetch,
      now: () => TOKEN_RESPONSE_NOW,
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
      target: {
        project: 'acme:analytics',
        environment: 'production',
      },
      token: `hqdp_v1_${'c'.repeat(43)}`,
    });
  });

  it('reports a non-object token response as an invalid Cloud response', async () => {
    await expect(loginCommand({ cloudUrl: 'https://cloud.example.test' }, {
      fetch: vi.fn(async () => new Response('null', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch,
      openBrowser: authorizeInBrowser,
      saveCredential: vi.fn(),
      timeoutMs: 2_000,
    })).rejects.toThrow('Cloud returned an invalid CLI token response.');
  });

  it('reports a malformed deployment endpoint as an invalid Cloud response', async () => {
    await expect(loginCommand({ cloudUrl: 'https://cloud.example.test' }, {
      fetch: vi.fn(async () => new Response(JSON.stringify({
        access_token: `hqdp_v1_${'c'.repeat(43)}`,
        token_type: 'Bearer',
        expires_at: '2030-01-01T00:00:00.000Z',
        scope: 'deploy:submit',
        deployment_endpoint: 'not a URL',
        deployment_target: {
          project: 'acme:analytics',
          environment: 'production',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as typeof fetch,
      now: () => TOKEN_RESPONSE_NOW,
      openBrowser: authorizeInBrowser,
      saveCredential: vi.fn(),
      timeoutMs: 2_000,
    })).rejects.toThrow('Cloud returned an invalid deployment endpoint.');
  });

  it('rejects a token response with an unexpected scope', async () => {
    await expect(loginCommand({ cloudUrl: 'https://cloud.example.test' }, {
      fetch: vi.fn(async () => new Response(JSON.stringify({
        access_token: `hqdp_v1_${'c'.repeat(43)}`,
        token_type: 'Bearer',
        expires_at: '2030-01-01T00:00:00.000Z',
        scope: 'admin',
        deployment_endpoint:
          'https://cloud.example.test/v1/deployments/submissions',
        deployment_target: {
          project: 'acme:analytics',
          environment: 'production',
        },
      }), { status: 200 })) as typeof fetch,
      now: () => TOKEN_RESPONSE_NOW,
      openBrowser: authorizeInBrowser,
      saveCredential: vi.fn(),
      timeoutMs: 2_000,
    })).rejects.toThrow('Cloud returned an invalid CLI token response.');
  });

  it('rejects an unexpectedly long-lived token response', async () => {
    await expect(loginCommand({ cloudUrl: 'https://cloud.example.test' }, {
      fetch: vi.fn(async () => new Response(JSON.stringify({
        access_token: `hqdp_v1_${'c'.repeat(43)}`,
        token_type: 'Bearer',
        expires_at: '2030-01-02T00:00:00.000Z',
        scope: 'deploy:submit',
        deployment_endpoint:
          'https://cloud.example.test/v1/deployments/submissions',
        deployment_target: {
          project: 'acme:analytics',
          environment: 'production',
        },
      }), { status: 200 })) as typeof fetch,
      now: () => TOKEN_RESPONSE_NOW,
      openBrowser: authorizeInBrowser,
      saveCredential: vi.fn(),
      timeoutMs: 2_000,
    })).rejects.toThrow('Cloud returned an invalid CLI token expiration.');
  });

  it('bounds the token response body', async () => {
    await expect(loginCommand({ cloudUrl: 'https://cloud.example.test' }, {
      fetch: vi.fn(async () => new Response('x'.repeat(65_537), {
        status: 200,
      })) as typeof fetch,
      openBrowser: authorizeInBrowser,
      saveCredential: vi.fn(),
      timeoutMs: 2_000,
    })).rejects.toThrow('Cloud returned an oversized CLI token response.');
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
        signal: expect.any(AbortSignal),
      }),
    );
    expect(deleteCredential).toHaveBeenCalledOnce();
  });

  it('still clears local state when the stored credential cannot be read', async () => {
    const fetchMock = vi.fn();
    const deleteCredential = vi.fn();

    await logoutCommand({
      fetch: fetchMock as unknown as typeof fetch,
      loadCredential: async () => {
        throw new Error('The stored Hypequery Cloud profile is invalid.');
      },
      deleteCredential,
    });

    // Nothing to revoke without a readable token, but logout is what users run
    // when local state is broken, so it must not leave the profile behind.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deleteCredential).toHaveBeenCalledOnce();
  });

  it('does not clear anything when no credential is stored', async () => {
    const deleteCredential = vi.fn();

    await logoutCommand({
      loadCredential: async () => null,
      deleteCredential,
    });

    expect(deleteCredential).not.toHaveBeenCalled();
  });

  it('accepts a token whose format Cloud has rotated', async () => {
    const saveCredential = vi.fn();
    await loginCommand({ cloudUrl: 'https://cloud.example.test' }, {
      fetch: vi.fn(async () => new Response(JSON.stringify({
        access_token: `hqdp_v2_${'c'.repeat(64)}`,
        token_type: 'Bearer',
        expires_at: '2030-01-01T00:00:00.000Z',
        scope: 'deploy:submit',
        deployment_endpoint: 'https://cloud.example.test/v2/deploy/submissions',
        deployment_target: {
          project: 'acme:analytics',
          environment: 'production',
        },
      }), { status: 200 })) as typeof fetch,
      now: () => TOKEN_RESPONSE_NOW,
      openBrowser: authorizeInBrowser,
      saveCredential,
      timeoutMs: 2_000,
    });

    expect(saveCredential).toHaveBeenCalledWith(expect.objectContaining({
      deploymentEndpoint: 'https://cloud.example.test/v2/deploy/submissions',
      token: `hqdp_v2_${'c'.repeat(64)}`,
    }));
  });

  it('rejects a token that is not a header-safe opaque credential', async () => {
    await expect(loginCommand({ cloudUrl: 'https://cloud.example.test' }, {
      fetch: vi.fn(async () => new Response(JSON.stringify({
        access_token: 'hqdp_short',
        token_type: 'Bearer',
        expires_at: '2030-01-01T00:00:00.000Z',
        scope: 'deploy:submit',
        deployment_endpoint:
          'https://cloud.example.test/v1/deployments/submissions',
        deployment_target: {
          project: 'acme:analytics',
          environment: 'production',
        },
      }), { status: 200 })) as typeof fetch,
      now: () => TOKEN_RESPONSE_NOW,
      openBrowser: authorizeInBrowser,
      saveCredential: vi.fn(),
      timeoutMs: 2_000,
    })).rejects.toThrow('Cloud returned an invalid CLI token response.');
  });

  it('rejects a deployment endpoint on another origin', async () => {
    await expect(loginCommand({ cloudUrl: 'https://cloud.example.test' }, {
      fetch: vi.fn(async () => new Response(JSON.stringify({
        access_token: `hqdp_v1_${'c'.repeat(43)}`,
        token_type: 'Bearer',
        expires_at: '2030-01-01T00:00:00.000Z',
        scope: 'deploy:submit',
        deployment_endpoint:
          'https://attacker.example.test/v1/deployments/submissions',
        deployment_target: {
          project: 'acme:analytics',
          environment: 'production',
        },
      }), { status: 200 })) as typeof fetch,
      now: () => TOKEN_RESPONSE_NOW,
      openBrowser: authorizeInBrowser,
      saveCredential: vi.fn(),
      timeoutMs: 2_000,
    })).rejects.toThrow('Cloud returned an invalid deployment endpoint.');
  });
});

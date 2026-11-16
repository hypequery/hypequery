import { describe, expect, it } from 'vitest';
import { CliError } from '../cli-error.js';
import { cloudApiOrigin, resolveCloudApiAccess } from './api-access.js';

const TOKEN = `hqmt_v1_${'a'.repeat(43)}`;

describe('cloudApiOrigin', () => {
  it('returns the origin of an HTTPS endpoint', () => {
    expect(cloudApiOrigin('https://cloud.example.com/v1/deployments/submissions')).toBe('https://cloud.example.com');
  });

  it.each([
    'http://localhost:3000/v1/deployments/submissions',
    'http://127.0.0.1:3000/v1/deployments/submissions',
    'http://[::1]:3000/v1/deployments/submissions',
  ])('allows loopback HTTP for local Cloud development: %s', endpoint => {
    expect(cloudApiOrigin(endpoint)).toBe(new URL(endpoint).origin);
  });

  it.each([
    'http://cloud.example.com/v1/deployments/submissions',
    'http://localhost.example.com/v1/deployments/submissions',
    'http://10.0.0.5:3000/v1/deployments/submissions',
    'ftp://cloud.example.com/v1',
    'https://user:secret@cloud.example.com/v1',
    'not a url',
  ])('refuses an endpoint a credential cannot safely be sent to: %s', endpoint => {
    expect(() => cloudApiOrigin(endpoint)).toThrowError(
      expect.objectContaining({ code: 'CLOUD_ENDPOINT_INSECURE', category: 'correctable_input', exitClass: 'correctable' }),
    );
  });

  it('never repeats credentials embedded in the endpoint', () => {
    try {
      cloudApiOrigin('http://user:secret@cloud.example.com/v1');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect(`${(error as CliError).message} ${(error as CliError).hint}`).not.toContain('secret');
    }
  });
});

describe('resolveCloudApiAccess', () => {
  it('refuses HYPEQUERY_API_TOKEN with a non-local HTTP endpoint before any request', async () => {
    // A management token goes only to its Cloud origin, which is always HTTPS
    // or loopback, so an HTTP endpoint on another host is refused there.
    await expect(resolveCloudApiAccess({
      env: { HYPEQUERY_API_TOKEN: TOKEN, HYPEQUERY_DEPLOYMENT_ENDPOINT: 'http://cloud.example.com/v1/deployments/submissions' },
    })).rejects.toMatchObject({ code: 'MANAGEMENT_TOKEN_ENDPOINT_MISMATCH' });
  });

  it('uses the origin of an HTTPS endpoint on the token\'s Cloud', async () => {
    await expect(resolveCloudApiAccess({
      env: {
        HYPEQUERY_API_TOKEN: TOKEN,
        HYPEQUERY_CLOUD_URL: 'https://cloud.example.com',
        HYPEQUERY_DEPLOYMENT_ENDPOINT: 'https://cloud.example.com/v1/deployments/submissions',
      },
    })).resolves.toMatchObject({ baseUrl: 'https://cloud.example.com', token: TOKEN, source: 'env' });
  });

  it('refuses a deploy key in HYPEQUERY_API_TOKEN, which /v1 does not accept', async () => {
    await expect(resolveCloudApiAccess({
      env: { HYPEQUERY_API_TOKEN: `hqdp_v1_${'d'.repeat(43)}` },
      loadCredential: async () => { throw new Error('the stored sign-in must not be read'); },
      loadManagementCredential: async () => { throw new Error('the stored sign-in must not be read'); },
    })).rejects.toMatchObject({
      code: 'CLOUD_MANAGEMENT_TOKEN_REQUIRED',
      exitClass: 'auth',
      hint: expect.stringContaining('hqmt_'),
    });
  });

  it('refuses the browser sign-in\'s deploy credential when no management token is stored', async () => {
    await expect(resolveCloudApiAccess({
      env: {},
      loadManagementCredential: async () => null,
      loadCredential: async () => ({
        cloudUrl: 'https://cloud.example.com',
        deploymentEndpoint: 'https://cloud.example.com/v1/deployments/submissions',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        scope: 'deploy:submit deploy:read-source',
        target: { project: 'acme:shop', environment: 'production' },
        token: `hqdp_v1_${'c'.repeat(43)}`,
      }),
    })).rejects.toMatchObject({
      code: 'CLOUD_MANAGEMENT_TOKEN_REQUIRED',
      exitClass: 'auth',
      hint: expect.stringContaining('hypequery login --device'),
    });
  });

  it('uses the stored management token ahead of the browser sign-in', async () => {
    await expect(resolveCloudApiAccess({
      env: {},
      loadCredential: async () => { throw new Error('the deploy credential must not be read'); },
      loadManagementCredential: async () => ({
        cloudUrl: 'https://cloud.example.com',
        token: TOKEN,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        deploymentEndpoint: 'https://cloud.example.com/v1/deployments/submissions',
        project: 'shop',
        projectLimited: false,
        signedInWith: 'browser',
      }),
    })).resolves.toEqual({
      baseUrl: 'https://cloud.example.com',
      token: TOKEN,
      source: 'management-token',
      defaultProject: 'shop',
    });
  });
});

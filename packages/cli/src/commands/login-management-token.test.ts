import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), success: vi.fn(), warn: vi.fn() },
}));

import { logger } from '../utils/logger.js';
import { setUnattended } from '../utils/input-mode.js';
import { resolveDeploymentCredential } from '../utils/cloud-deployment-access.js';
import { VaultUnavailableError } from '../utils/cloud-vault.js';
import type { StoredCloudCredential } from '../utils/cloud-credential-store.js';
import {
  deleteManagementCredentials as deleteStoredManagementCredentials,
  loadManagementCredential,
  saveManagementCredential as saveStoredManagementCredential,
  type StoredManagementCredential,
} from '../utils/management-token-store.js';
import { loginCommand, logoutCommand, type LoginDependencies } from './login.js';

const ORIGIN = 'https://cloud.example.test';
const NOW = Date.parse('2029-12-31T12:00:00.000Z');
const MANAGEMENT_TOKEN = `hqmt_v1_${'m'.repeat(43)}`;
const DEPLOY_TOKEN = `hqdp_v1_${'c'.repeat(43)}`;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A stub Cloud for device sign-in: the code endpoint, then each poll in turn. */
function deviceCloud(...polls: Array<() => Response>) {
  const requests: Array<{ path: string; body: unknown }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    requests.push({ path, body: JSON.parse(String(init?.body)) });
    if (path === '/api/cli/device/code') {
      return json(200, {
        device_code: `hqdc_v1_${'d'.repeat(43)}`,
        user_code: 'BCDF-GHJK',
        verification_uri: `${ORIGIN}/cli/device`,
        verification_uri_complete: `${ORIGIN}/cli/device?code=BCDF-GHJK`,
        expires_in: 600,
        interval: 5,
      });
    }
    const next = polls.shift();
    if (!next) throw new Error('unexpected poll');
    return next();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

function approved(overrides: Record<string, unknown> = {}) {
  return json(200, {
    access_token: MANAGEMENT_TOKEN,
    token_type: 'Bearer',
    expires_in: 2_592_000,
    expires_at: '2030-01-30T12:00:00.000Z',
    management_token: MANAGEMENT_TOKEN,
    management_token_expires_at: '2030-01-30T12:00:00.000Z',
    management_api: `${ORIGIN}/v1`,
    organization_id: 'org_1',
    project: 'shop',
    project_limited: true,
    capabilities: ['workspace:view', 'deployment:publish'],
    ...overrides,
  });
}

function deviceDependencies(cloud: ReturnType<typeof deviceCloud>, overrides: Partial<LoginDependencies> = {}) {
  let now = NOW;
  return {
    fetch: cloud.fetch,
    now: () => now,
    sleep: vi.fn(async (milliseconds: number) => {
      now += milliseconds;
    }),
    openBrowser: vi.fn(async () => undefined),
    isInteractive: () => false,
    saveManagementCredential: vi.fn(async () => ({ storage: 'vault' as const, path: '/config/cloud-management-tokens.json' })),
    ...overrides,
  } satisfies LoginDependencies;
}

afterEach(() => {
  setUnattended(false, {});
  vi.clearAllMocks();
});

describe('hypequery login --device', () => {
  it('prints the code, polls through pending and slow_down, and stores the management token', async () => {
    const cloud = deviceCloud(
      () => json(400, { error: 'authorization_pending', interval: 5 }),
      () => json(400, { error: 'slow_down', interval: 10 }),
      () => approved(),
    );
    const dependencies = deviceDependencies(cloud);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await loginCommand({ cloudUrl: ORIGIN, device: true, project: 'shop', capabilities: 'workspace:view,deployment:publish' }, dependencies);
    // The code is for a person: stderr in every output mode, so redirecting
    // stdout (`login --device > login.log`) never hides it.
    const printed = stderr.mock.calls.map(([line]) => String(line)).join('\n');
    expect(stdout).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info).mock.calls.join('\n')).not.toContain('BCDF-GHJK');
    stderr.mockRestore();
    stdout.mockRestore();

    expect(cloud.requests[0]).toEqual({
      path: '/api/cli/device/code',
      body: { client_id: 'hypequery-cli', project: 'shop', capabilities: ['workspace:view', 'deployment:publish'] },
    });
    expect(dependencies.sleep.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([5_000, 5_000, 10_000]);
    expect(printed).toContain('BCDF-GHJK');
    expect(printed).toContain(`${ORIGIN}/cli/device`);
    expect(printed).not.toContain(MANAGEMENT_TOKEN);
    expect(dependencies.saveManagementCredential).toHaveBeenCalledWith({
      cloudUrl: ORIGIN,
      token: MANAGEMENT_TOKEN,
      expiresAt: '2030-01-30T12:00:00.000Z',
      deploymentEndpoint: `${ORIGIN}/v1/deployments/submissions`,
      organizationId: 'org_1',
      project: 'shop',
      projectLimited: true,
      capabilities: ['workspace:view', 'deployment:publish'],
      signedInWith: 'device',
    } satisfies StoredManagementCredential);
  });

  it('opens a browser only when a person is at the terminal', async () => {
    const headless = deviceDependencies(deviceCloud(() => approved()));
    await loginCommand({ cloudUrl: ORIGIN, device: true }, headless);
    expect(headless.openBrowser).not.toHaveBeenCalled();

    const attended = deviceDependencies(deviceCloud(() => approved()), { isInteractive: () => true });
    await loginCommand({ cloudUrl: ORIGIN, device: true }, attended);
    expect(attended.openBrowser).toHaveBeenCalledWith(`${ORIGIN}/cli/device?code=BCDF-GHJK`);
  });

  it('runs with --no-input, where browser sign-in refuses', async () => {
    setUnattended(true, {});
    const dependencies = deviceDependencies(deviceCloud(() => approved()));
    await expect(loginCommand({ cloudUrl: ORIGIN, device: true }, dependencies)).resolves.toBeUndefined();
    await expect(loginCommand({ cloudUrl: ORIGIN }, {})).rejects.toMatchObject({
      code: 'LOGIN_NEEDS_A_PERSON',
      hint: expect.stringContaining('--device'),
    });
  });

  it.each([
    ['denied', () => json(400, { error: 'access_denied' }), 'CLOUD_AUTHORIZATION_DECLINED'],
    ['expired', () => json(400, { error: 'expired_token' }), 'CLOUD_AUTHORIZATION_TIMED_OUT'],
  ])('stores nothing when the sign-in is %s', async (_case, poll, code) => {
    const dependencies = deviceDependencies(deviceCloud(poll));
    await expect(loginCommand({ cloudUrl: ORIGIN, device: true }, dependencies))
      .rejects.toMatchObject({ code, exitClass: 'auth' });
    expect(dependencies.saveManagementCredential).not.toHaveBeenCalled();
  });

  it('refuses a malformed token', async () => {
    const dependencies = deviceDependencies(deviceCloud(() => approved({ access_token: 'hqmt_short', management_token: 'hqmt_short' })));
    await expect(loginCommand({ cloudUrl: ORIGIN, device: true }, dependencies)).rejects.toThrow(/invalid management token/);
    expect(dependencies.saveManagementCredential).not.toHaveBeenCalled();
  });

  it('keeps flags that belong to one sign-in method with that method', async () => {
    await expect(loginCommand({ cloudUrl: ORIGIN, project: 'shop' }, {})).rejects.toMatchObject({ code: 'USAGE' });
    await expect(loginCommand({ cloudUrl: ORIGIN, device: true, environment: 'production' }, {}))
      .rejects.toMatchObject({ code: 'USAGE' });
    await expect(loginCommand({ cloudUrl: ORIGIN, device: true, capabilities: 'NOT A CAPABILITY!' }, {}))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('hypequery login (browser) and management tokens', () => {
  function authorizeInBrowser(input: string) {
    const authorizeUrl = new URL(input);
    const callback = new URL(authorizeUrl.searchParams.get('redirect_uri') as string);
    callback.searchParams.set('code', `hqac_v1_${'d'.repeat(43)}`);
    callback.searchParams.set('state', authorizeUrl.searchParams.get('state') as string);
    return fetch(callback);
  }

  function tokenResponse(extra: Record<string, unknown> = {}) {
    return {
      access_token: DEPLOY_TOKEN,
      token_type: 'Bearer',
      expires_at: '2030-01-01T00:00:00.000Z',
      scope: 'deploy:submit deploy:read-source',
      deployment_endpoint: `${ORIGIN}/v1/deployments/submissions`,
      deployment_target: { project: 'acme:shop', environment: 'production' },
      ...extra,
    };
  }

  it('asks for a management token and stores it with the target browser sign-in named', async () => {
    let requestBody: Record<string, unknown> | undefined;
    const saveManagementCredential = vi.fn(async () => ({ storage: 'vault' as const, path: '/x' }));
    const deleteManagementCredentials = vi.fn(async () => undefined);
    await loginCommand({ cloudUrl: ORIGIN }, {
      fetch: vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return json(200, tokenResponse({
          management_token: MANAGEMENT_TOKEN,
          management_token_expires_at: '2030-01-30T12:00:00.000Z',
          management_api: `${ORIGIN}/v1`,
          organization_id: 'org_1',
          project: 'shop',
          project_limited: false,
          capabilities: ['workspace:view'],
        }));
      }) as typeof fetch,
      now: () => NOW,
      openBrowser: authorizeInBrowser,
      saveCredential: vi.fn(),
      saveManagementCredential,
      deleteManagementCredentials,
      timeoutMs: 2_000,
    });
    expect(requestBody).toMatchObject({ grant_type: 'authorization_code', management_token: true });
    expect(saveManagementCredential).toHaveBeenCalledWith(expect.objectContaining({
      token: MANAGEMENT_TOKEN,
      deploymentEndpoint: `${ORIGIN}/v1/deployments/submissions`,
      target: { project: 'acme:shop', environment: 'production' },
      projectLimited: false,
      signedInWith: 'browser',
    }));
    expect(deleteManagementCredentials).not.toHaveBeenCalled();
  });

  it('works against a Cloud without management tokens, dropping any older one for that origin', async () => {
    const saveCredential = vi.fn();
    const saveManagementCredential = vi.fn();
    const deleteManagementCredentials = vi.fn(async () => undefined);
    await loginCommand({ cloudUrl: ORIGIN }, {
      fetch: vi.fn(async () => json(200, tokenResponse())) as typeof fetch,
      now: () => NOW,
      openBrowser: authorizeInBrowser,
      saveCredential,
      saveManagementCredential,
      deleteManagementCredentials,
      timeoutMs: 2_000,
    });
    expect(saveCredential).toHaveBeenCalledWith(expect.objectContaining({ token: DEPLOY_TOKEN }));
    expect(saveManagementCredential).not.toHaveBeenCalled();
    expect(deleteManagementCredentials).toHaveBeenCalledWith({ cloudUrl: ORIGIN, clearDefault: true });
  });

  it('makes a browser sign-in to a Cloud without management tokens the one commands use', async () => {
    const configDirectory = await mkdtemp(path.join(tmpdir(), 'hypequery-login-test-'));
    try {
      const passwords = new Map<string, string>();
      const store = {
        configDirectory,
        createKeyringEntry: (_service: string, account: string) => ({
          setPassword: (password: string) => {
            passwords.set(account, password);
          },
          getPassword: () => passwords.get(account) ?? null,
          deletePassword: () => passwords.delete(account),
        }),
      };
      // An earlier device sign-in to another Cloud is the default.
      const other = 'https://other.example.test';
      await saveStoredManagementCredential({
        cloudUrl: other,
        token: MANAGEMENT_TOKEN,
        expiresAt: '2030-01-30T12:00:00.000Z',
        deploymentEndpoint: `${other}/v1/deployments/submissions`,
        projectLimited: false,
        target: { project: 'acme:other', environment: 'production' },
        signedInWith: 'device',
      }, store);

      let saved: StoredCloudCredential | null = null;
      await loginCommand({ cloudUrl: ORIGIN }, {
        fetch: vi.fn(async () => json(200, tokenResponse())) as typeof fetch,
        now: () => NOW,
        openBrowser: authorizeInBrowser,
        saveCredential: async (credential) => {
          saved = credential;
        },
        saveManagementCredential: credential => saveStoredManagementCredential(credential, store),
        deleteManagementCredentials: options => deleteStoredManagementCredentials(options, store),
        timeoutMs: 2_000,
      });

      const access = {
        loadCredential: async () => saved && { ...saved, expiresAt: new Date(Date.now() + 60_000).toISOString() },
        loadManagementCredential: (options: { readonly cloudUrl?: string }) => loadManagementCredential(options, store),
      };
      // With no target flags and no HYPEQUERY_CLOUD_URL, commands go to the
      // Cloud just signed in to, not the older device sign-in's.
      await expect(resolveDeploymentCredential(undefined, { env: {}, ...access })).resolves.toMatchObject({
        source: 'login',
        endpoint: `${ORIGIN}/v1/deployments/submissions`,
        token: DEPLOY_TOKEN,
        target: { project: 'acme:shop', environment: 'production' },
      });
      // The other Cloud's token is still there when it is asked for by name.
      await expect(resolveDeploymentCredential(undefined, { env: { HYPEQUERY_CLOUD_URL: other }, ...access }))
        .resolves.toMatchObject({ source: 'management-token', endpoint: `${other}/v1/deployments/submissions` });
    } finally {
      await rm(configDirectory, { force: true, recursive: true });
    }
  });

  it('signs in with only the management token where there is no vault for the deploy credential', async () => {
    const saveManagementCredential = vi.fn(async () => ({ storage: 'file' as const, path: '/config/cloud-management-tokens.json' }));
    const deleteManagementCredentials = vi.fn(async () => undefined);
    await expect(loginCommand({ cloudUrl: ORIGIN }, {
      fetch: vi.fn(async () => json(200, tokenResponse({
        management_token: MANAGEMENT_TOKEN,
        management_token_expires_at: '2030-01-30T12:00:00.000Z',
      }))) as typeof fetch,
      now: () => NOW,
      openBrowser: authorizeInBrowser,
      saveCredential: vi.fn(async () => {
        throw new VaultUnavailableError(new Error('no Secret Service'));
      }),
      saveManagementCredential,
      deleteManagementCredentials,
      timeoutMs: 2_000,
    })).resolves.toBeUndefined();
    expect(saveManagementCredential).toHaveBeenCalledWith(expect.objectContaining({
      token: MANAGEMENT_TOKEN,
      target: { project: 'acme:shop', environment: 'production' },
    }));
    expect(deleteManagementCredentials).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('/config/cloud-management-tokens.json'));
    expect(vi.mocked(logger.success)).toHaveBeenCalledWith('Logged in to Hypequery Cloud');
    // The expiry reported is the stored credential's, not the deploy credential's.
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      `Credential expires ${new Date('2030-01-30T12:00:00.000Z').toLocaleString()}`,
    );
  });

  it('fails without a vault when Cloud issued no management token, leaving stored tokens alone', async () => {
    const saveManagementCredential = vi.fn();
    const deleteManagementCredentials = vi.fn(async () => undefined);
    await expect(loginCommand({ cloudUrl: ORIGIN }, {
      fetch: vi.fn(async () => json(200, tokenResponse())) as typeof fetch,
      now: () => NOW,
      openBrowser: authorizeInBrowser,
      saveCredential: vi.fn(async () => {
        throw new VaultUnavailableError(new Error('no Secret Service'));
      }),
      saveManagementCredential,
      deleteManagementCredentials,
      timeoutMs: 2_000,
    })).rejects.toBeInstanceOf(VaultUnavailableError);
    expect(saveManagementCredential).not.toHaveBeenCalled();
    expect(deleteManagementCredentials).not.toHaveBeenCalled();
    expect(vi.mocked(logger.success)).not.toHaveBeenCalled();
  });
});

describe('hypequery logout and management tokens', () => {
  it('revokes and removes every stored management token', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    const deleteManagementCredentials = vi.fn(async () => undefined);
    await logoutCommand({
      env: {},
      fetch: fetchMock as unknown as typeof fetch,
      loadCredential: async () => null,
      deleteCredential: vi.fn(),
      loadManagementCredentials: async () => ({
        credentials: [{
          cloudUrl: ORIGIN,
          token: MANAGEMENT_TOKEN,
          expiresAt: '2030-01-30T12:00:00.000Z',
          deploymentEndpoint: `${ORIGIN}/v1/deployments/submissions`,
          projectLimited: false,
          signedInWith: 'device',
        }],
        unreadable: 0,
      }),
      deleteManagementCredentials,
    });
    expect(fetchMock).toHaveBeenCalledWith(new URL(`${ORIGIN}/api/cli/token`), expect.objectContaining({
      method: 'DELETE',
      headers: { Authorization: `Bearer ${MANAGEMENT_TOKEN}` },
    }));
    expect(deleteManagementCredentials).toHaveBeenCalledWith();
  });

  it('says HYPEQUERY_API_TOKEN still applies after logout', async () => {
    await logoutCommand({
      env: { HYPEQUERY_API_TOKEN: MANAGEMENT_TOKEN },
      loadCredential: async () => null,
      deleteCredential: vi.fn(),
      loadManagementCredentials: async () => ({ credentials: [], unreadable: 0 }),
      deleteManagementCredentials: vi.fn(),
    });
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('HYPEQUERY_API_TOKEN'));
  });
});

import { describe, expect, it, vi } from 'vitest';

import {
  resolveDeploymentCredential,
  storedDeploymentTarget,
  type CloudDeploymentAccessDependencies,
} from './cloud-deployment-access.js';
import type { StoredCloudCredential } from './cloud-credential-store.js';
import type { StoredManagementCredential } from './management-token-store.js';

const MANAGEMENT_TOKEN = `hqmt_v1_${'m'.repeat(43)}`;
const DEPLOY_KEY = `hqdp_v1_${'d'.repeat(43)}`;
const future = () => new Date(Date.now() + 60 * 60_000).toISOString();

function stored(overrides: Partial<StoredManagementCredential> = {}): StoredManagementCredential {
  return {
    cloudUrl: 'https://cloud.example.test',
    token: MANAGEMENT_TOKEN,
    expiresAt: future(),
    deploymentEndpoint: 'https://cloud.example.test/v1/deployments/submissions',
    projectLimited: false,
    signedInWith: 'device',
    ...overrides,
  };
}

function login(): StoredCloudCredential {
  return {
    cloudUrl: 'https://login.example.test',
    deploymentEndpoint: 'https://login.example.test/v1/deployments/submissions',
    expiresAt: future(),
    scope: 'deploy:submit deploy:read-source',
    target: { project: 'acme:login', environment: 'production' },
    token: DEPLOY_KEY,
  };
}

/** Stored-credential loaders that fail the test if they are read. */
function untouchedStores(): Required<Pick<CloudDeploymentAccessDependencies, 'loadCredential' | 'loadManagementCredential'>> {
  return {
    loadCredential: vi.fn(async () => {
      throw new Error('the stored login must not be read');
    }),
    loadManagementCredential: vi.fn(async () => {
      throw new Error('the stored management token must not be read');
    }),
  };
}

describe('resolveDeploymentCredential', () => {
  it('HYPEQUERY_API_TOKEN with a management token goes to the default Cloud without reading the store', async () => {
    const stores = untouchedStores();
    await expect(resolveDeploymentCredential(undefined, {
      env: { HYPEQUERY_API_TOKEN: MANAGEMENT_TOKEN },
      ...stores,
    })).resolves.toEqual({
      endpoint: 'https://cloud.hypequery.com/v1/deployments/submissions',
      token: MANAGEMENT_TOKEN,
      source: 'env',
      tokenKind: 'management',
    });
    expect(stores.loadCredential).not.toHaveBeenCalled();
    expect(stores.loadManagementCredential).not.toHaveBeenCalled();
  });

  it('a deploy key finds its endpoint on HYPEQUERY_CLOUD_URL', async () => {
    await expect(resolveDeploymentCredential(undefined, {
      env: { HYPEQUERY_API_TOKEN: DEPLOY_KEY, HYPEQUERY_CLOUD_URL: 'http://localhost:3000' },
      ...untouchedStores(),
    })).resolves.toMatchObject({
      endpoint: 'http://localhost:3000/v1/deployments/submissions',
      token: DEPLOY_KEY,
      tokenKind: 'deploy-key',
    });
  });

  it('an explicit endpoint wins, and still accepts any token', async () => {
    await expect(resolveDeploymentCredential('https://deploy.example.test/v1/releases', {
      env: { HYPEQUERY_API_TOKEN: 'opaque-token' },
      ...untouchedStores(),
    })).resolves.toEqual({
      endpoint: 'https://deploy.example.test/v1/releases',
      token: 'opaque-token',
      source: 'env',
      tokenKind: 'unknown',
    });
  });

  it('refuses a token with an unknown prefix and no endpoint, naming the accepted prefixes', async () => {
    const failure = resolveDeploymentCredential(undefined, {
      env: { HYPEQUERY_API_TOKEN: 'sk_live_abc' },
      ...untouchedStores(),
    });
    await expect(failure).rejects.toMatchObject({ code: 'CLOUD_TOKEN_WITHOUT_ENDPOINT' });
    await expect(failure).rejects.toThrow(/hqmt_.*hqdp_/s);
  });

  it('refuses an endpoint without a token', async () => {
    await expect(resolveDeploymentCredential(undefined, {
      env: { HYPEQUERY_DEPLOYMENT_ENDPOINT: 'https://deploy.example.test/v1/releases' },
      ...untouchedStores(),
    })).rejects.toMatchObject({ code: 'CLOUD_ENDPOINT_WITHOUT_TOKEN' });
  });

  it('prefers a stored management token over the browser sign-in credential', async () => {
    const loadCredential = vi.fn(async () => login());
    const target = { project: 'acme:shop', environment: 'production' };
    await expect(resolveDeploymentCredential(undefined, {
      env: {},
      loadCredential,
      loadManagementCredential: async () => stored({ target }),
    })).resolves.toEqual({
      endpoint: 'https://cloud.example.test/v1/deployments/submissions',
      token: MANAGEMENT_TOKEN,
      source: 'management-token',
      tokenKind: 'management',
      target,
    });
    expect(loadCredential).not.toHaveBeenCalled();
  });

  it('reads the management token for HYPEQUERY_CLOUD_URL when it is set', async () => {
    const loadManagementCredential = vi.fn(async () => stored());
    await resolveDeploymentCredential(undefined, {
      env: { HYPEQUERY_CLOUD_URL: 'https://cloud.example.test/' },
      loadCredential: async () => null,
      loadManagementCredential,
    });
    expect(loadManagementCredential).toHaveBeenCalledWith({ cloudUrl: 'https://cloud.example.test' });
  });

  it('refuses an expired management token', async () => {
    await expect(resolveDeploymentCredential(undefined, {
      env: {},
      loadCredential: async () => login(),
      loadManagementCredential: async () => stored({ expiresAt: '2020-01-01T00:00:00.000Z' }),
    })).rejects.toMatchObject({ code: 'CLOUD_CREDENTIAL_EXPIRED', exitClass: 'auth' });
  });

  it('falls back to the browser sign-in credential', async () => {
    await expect(resolveDeploymentCredential(undefined, {
      env: {},
      loadCredential: async () => login(),
      loadManagementCredential: async () => null,
    })).resolves.toMatchObject({
      endpoint: 'https://login.example.test/v1/deployments/submissions',
      token: DEPLOY_KEY,
      source: 'login',
      tokenKind: 'deploy-key',
      target: { project: 'acme:login', environment: 'production' },
      storedCredential: login(),
    });
  });

  it('says how to sign in when nothing is configured', async () => {
    await expect(resolveDeploymentCredential(undefined, {
      env: {},
      loadCredential: async () => null,
      loadManagementCredential: async () => null,
    })).rejects.toMatchObject({ code: 'CLOUD_NOT_SIGNED_IN', exitClass: 'auth', hint: expect.stringContaining('--device') });
  });
});

describe('storedDeploymentTarget', () => {
  it('takes the management token\'s target, and never mixes in the browser sign-in\'s', async () => {
    await expect(storedDeploymentTarget({
      env: {},
      loadCredential: async () => login(),
      loadManagementCredential: async () => stored(),
    })).resolves.toBeUndefined();
    await expect(storedDeploymentTarget({
      env: {},
      loadCredential: async () => login(),
      loadManagementCredential: async () => null,
    })).resolves.toEqual({ project: 'acme:login', environment: 'production' });
  });
});

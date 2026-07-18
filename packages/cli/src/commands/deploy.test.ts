import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareProtocolDeploymentReleaseEnvelope } from '@hypequery/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockVerifyDeploymentBundle = vi.hoisted(() => vi.fn());

vi.mock('../utils/deployment-bundle.js', () => ({
  verifyDeploymentBundle: mockVerifyDeploymentBundle,
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    success: vi.fn(),
    info: vi.fn(),
  },
}));

import { deployCommand } from './deploy.js';

const BUNDLE_IDENTITY = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
const temporaryDirectories: string[] = [];

async function releaseFile(bundleIdentity = BUNDLE_IDENTITY): Promise<{
  path: string;
  identity: string;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-push-command-test-'));
  temporaryDirectories.push(directory);
  const release = prepareProtocolDeploymentReleaseEnvelope({
    kind: 'hypequery-deployment-release',
    version: 1,
    bundleIdentity,
    target: { project: 'project-1', environment: 'production' },
  });
  const releasePath = path.join(directory, 'release.json');
  await writeFile(releasePath, `${release.canonical}\n`, 'utf8');
  return { path: releasePath, identity: release.identity };
}

const bundle = {
  directory: '/project/dist/bundle',
  manifest: {
    kind: 'hypequery-deployment-bundle' as const,
    version: 1 as const,
    deployment: {
      path: 'deployment.json',
      identity: '1'.repeat(64),
      sha256: '2'.repeat(64),
      byteLength: 1,
    },
    artifacts: [],
  },
  identity: BUNDLE_IDENTITY,
  contract: {
    kind: 'hypequery-deployment' as const,
    version: 1 as const,
    datasets: [],
    queries: [],
    artifacts: [],
  },
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe('deploy command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockVerifyDeploymentBundle.mockResolvedValue(bundle);
  });

  it('verifies and submits an explicit release using environment credentials', async () => {
    const release = await releaseFile();
    const submit = vi.fn().mockResolvedValue({
      kind: 'hypequery-deployment-submission',
      version: 1,
      status: 'accepted',
      releaseIdentity: release.identity,
      bundleIdentity: BUNDLE_IDENTITY,
    });
    const createTransport = vi.fn(() => ({ submit }));

    const result = await deployCommand('dist/bundle', {
      release: release.path,
      endpoint: 'https://deploy.example.test/v1/releases',
    }, {
      env: { HYPEQUERY_API_TOKEN: 'secret-token' },
      createTransport,
    });

    expect(mockVerifyDeploymentBundle).toHaveBeenCalledWith('dist/bundle');
    expect(createTransport).toHaveBeenCalledWith({
      endpoint: 'https://deploy.example.test/v1/releases',
      token: 'secret-token',
    });
    expect(submit).toHaveBeenCalledWith(
      bundle,
      expect.objectContaining({ identity: release.identity }),
    );
    expect(result.status).toBe('accepted');
  });

  it('reads the endpoint from the environment', async () => {
    const release = await releaseFile();
    const submit = vi.fn().mockResolvedValue({
      kind: 'hypequery-deployment-submission',
      version: 1,
      status: 'already-exists',
      releaseIdentity: release.identity,
      bundleIdentity: BUNDLE_IDENTITY,
    });
    const createTransport = vi.fn(() => ({ submit }));

    await deployCommand('dist/bundle', { release: release.path }, {
      env: {
        HYPEQUERY_API_TOKEN: 'secret-token',
        HYPEQUERY_DEPLOYMENT_ENDPOINT: 'https://deploy.example.test/v1/releases',
      },
      createTransport,
    });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://deploy.example.test/v1/releases',
    }));
  });

  it('requires endpoint and token configuration before bundle verification', async () => {
    const release = await releaseFile();
    await expect(deployCommand('dist/bundle', { release: release.path }, { env: {} }))
      .rejects.toThrow(/Missing deployment endpoint/);
    await expect(deployCommand('dist/bundle', {
      release: release.path,
      endpoint: 'https://deploy.example.test/v1/releases',
    }, { env: {} })).rejects.toThrow(/Missing HYPEQUERY_API_TOKEN/);
    expect(mockVerifyDeploymentBundle).not.toHaveBeenCalled();
  });

  it('does not submit a release whose bundle identity differs', async () => {
    const release = await releaseFile('0'.repeat(64));
    const createTransport = vi.fn();

    await expect(deployCommand('dist/bundle', {
      release: release.path,
      endpoint: 'https://deploy.example.test/v1/releases',
    }, {
      env: { HYPEQUERY_API_TOKEN: 'secret-token' },
      createTransport,
    })).rejects.toMatchObject({ code: 'HQ_UPLOAD_IDENTITY_MISMATCH' });
    expect(createTransport).not.toHaveBeenCalled();
  });

  it('reports malformed release JSON with its path', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'hypequery-push-command-test-'));
    temporaryDirectories.push(directory);
    const releasePath = path.join(directory, 'broken.json');
    await writeFile(releasePath, '{', 'utf8');

    await expect(deployCommand('dist/bundle', {
      release: releasePath,
      endpoint: 'https://deploy.example.test/v1/releases',
    }, {
      env: { HYPEQUERY_API_TOKEN: 'secret-token' },
    })).rejects.toThrow(new RegExp(`Invalid deployment release JSON: ${releasePath}`));
  });

  it('reports bundle verification failure before opening the release', async () => {
    mockVerifyDeploymentBundle.mockRejectedValue(new Error('manifest mismatch'));

    await expect(deployCommand('dist/bundle', {
      release: '/missing/release.json',
      endpoint: 'https://deploy.example.test/v1/releases',
    }, {
      env: { HYPEQUERY_API_TOKEN: 'secret-token' },
    })).rejects.toThrow(/Cannot push an invalid deployment bundle[\s\S]*manifest mismatch/);
  });
});

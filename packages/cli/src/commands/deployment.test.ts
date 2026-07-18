import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareProtocolDeploymentContract } from '@hypequery/protocol';

const mockLoadApiModule = vi.hoisted(() => vi.fn());
const mockBuildNodeRuntimeArtifact = vi.hoisted(() => vi.fn());
const mockGetDeploymentRuntimeEntrypoints = vi.hoisted(() => vi.fn());
const mockWriteDeploymentBundle = vi.hoisted(() => vi.fn());
const mockVerifyDeploymentBundle = vi.hoisted(() => vi.fn());
const mockReadDeploymentRuntimeFile = vi.hoisted(() => vi.fn());

vi.mock('../utils/load-api.js', () => ({
  loadApiModule: mockLoadApiModule,
}));

vi.mock('../utils/deployment-runtime-artifact.js', () => ({
  buildNodeRuntimeArtifact: mockBuildNodeRuntimeArtifact,
  getDeploymentRuntimeEntrypoints: mockGetDeploymentRuntimeEntrypoints,
}));

vi.mock('../utils/deployment-bundle.js', () => ({
  writeDeploymentBundle: mockWriteDeploymentBundle,
  verifyDeploymentBundle: mockVerifyDeploymentBundle,
  readDeploymentRuntimeFile: mockReadDeploymentRuntimeFile,
}));

vi.mock('../utils/logger.js', () => ({
  logger: {
    success: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    mkdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    writeFile: vi.fn(),
  };
});

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { buildDeploymentCommand, validateDeploymentCommand } from './deployment.js';

const ARTIFACT_SHA = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const contract = {
  kind: 'hypequery-deployment' as const,
  version: 1 as const,
  datasets: [],
  queries: [],
  artifacts: [],
};

describe('deployment commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDeploymentRuntimeEntrypoints.mockReturnValue([]);
    vi.mocked(stat).mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
    mockWriteDeploymentBundle.mockImplementation(async (directory, prepared) => ({
      directory,
      manifest: {
        kind: 'hypequery-deployment-bundle',
        version: 1,
        deployment: {
          path: 'deployment.json',
          identity: prepared.identity,
          sha256: '0'.repeat(64),
          byteLength: 1,
        },
        artifacts: [],
      },
      identity: 'f'.repeat(64),
      contract: prepared.contract,
    }));
  });

  it('builds canonical deployment JSON and a domain-separated identity sidecar', async () => {
    const deploymentContract = vi.fn(() => contract);
    mockLoadApiModule.mockResolvedValue({ deploymentContract });
    const prepared = prepareProtocolDeploymentContract(contract);

    await buildDeploymentCommand('analytics/api.ts', {
      output: 'dist/deployment.json',
      runtimeArtifact: ARTIFACT_SHA,
      entrypointPrefix: 'handlers',
    });

    expect(deploymentContract).toHaveBeenCalledWith({
      runtimeArtifact: {
        runtime: 'node',
        artifactSha256: ARTIFACT_SHA,
        entrypointPrefix: 'handlers',
      },
    });
    expect(mkdir).toHaveBeenCalledWith('dist', { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      'dist/deployment.json',
      `${prepared.canonical}\n`,
      'utf8',
    );
    expect(writeFile).toHaveBeenCalledWith(
      'dist/deployment.json.sha256',
      '# Hypequery deployment identity v1; not a file checksum or sha256sum input.\n'
      + '# SHA-256(UTF-8("hypequery:deployment:v1") || 0x00 || RFC 8785 canonical bytes); '
      + 'the output newline is excluded.\n'
      + `${prepared.identity}  deployment.json\n`,
      'utf8',
    );
    expect(mockBuildNodeRuntimeArtifact).not.toHaveBeenCalled();
  });

  it('bundles Node handlers and wires their digest into the deployment contract', async () => {
    const deploymentContract = vi.fn(() => contract);
    const bytes = new TextEncoder().encode('export const queries = {};\n');
    mockLoadApiModule.mockResolvedValue({ deploymentContract });
    mockGetDeploymentRuntimeEntrypoints.mockReturnValue(['greeting']);
    mockBuildNodeRuntimeArtifact.mockResolvedValue({
      bytes,
      artifactSha256: ARTIFACT_SHA,
      entrypointPrefix: 'queries',
      runtimeEntrypoints: ['greeting'],
    });

    await buildDeploymentCommand('analytics/api.ts', {
      output: 'dist/deployment.json',
      runtimeOutput: 'dist/runtime.mjs',
    });

    expect(mockBuildNodeRuntimeArtifact).toHaveBeenCalledWith(
      'analytics/api.ts',
      ['greeting'],
      undefined,
    );
    expect(deploymentContract).toHaveBeenCalledWith({
      runtimeArtifact: {
        runtime: 'node',
        artifactSha256: ARTIFACT_SHA,
        entrypointPrefix: 'queries',
      },
    });
    expect(writeFile).toHaveBeenCalledWith('dist/runtime.mjs', bytes);
  });

  it('writes a complete deployment bundle by default', async () => {
    const deploymentContract = vi.fn(() => contract);
    mockLoadApiModule.mockResolvedValue({ deploymentContract });

    await buildDeploymentCommand('analytics/api.ts');

    expect(mockWriteDeploymentBundle).toHaveBeenCalledWith(
      'analytics/hypequery-deployment',
      expect.objectContaining({ contract }),
      [],
    );
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('includes automatically built runtime bytes in the bundle', async () => {
    const runtimeContract = {
      ...contract,
      artifacts: [{ runtime: 'node' as const, artifactSha256: ARTIFACT_SHA }],
    };
    const bytes = new TextEncoder().encode('export const queries = {};\n');
    mockLoadApiModule.mockResolvedValue({ deploymentContract: vi.fn(() => runtimeContract) });
    mockGetDeploymentRuntimeEntrypoints.mockReturnValue(['greeting']);
    mockBuildNodeRuntimeArtifact.mockResolvedValue({
      bytes,
      artifactSha256: ARTIFACT_SHA,
      entrypointPrefix: 'queries',
      runtimeEntrypoints: ['greeting'],
    });

    await buildDeploymentCommand('analytics/api.ts', { bundleOutput: 'dist/bundle' });

    expect(mockWriteDeploymentBundle).toHaveBeenCalledWith(
      'dist/bundle',
      expect.objectContaining({ contract: runtimeContract }),
      [{ runtime: 'node', sha256: ARTIFACT_SHA, bytes }],
    );
  });

  it('requires prebuilt runtime bytes for a complete bundle', async () => {
    await expect(buildDeploymentCommand('analytics/api.ts', {
      runtimeArtifact: ARTIFACT_SHA,
    })).rejects.toThrow(/requires --runtime-file/);
    expect(mockLoadApiModule).not.toHaveBeenCalled();
  });

  it('verifies and includes prebuilt runtime bytes', async () => {
    const bytes = new TextEncoder().encode('python-runtime');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const runtimeContract = {
      ...contract,
      artifacts: [{ runtime: 'python' as const, artifactSha256: digest }],
    };
    mockReadDeploymentRuntimeFile.mockResolvedValue(bytes);
    mockLoadApiModule.mockResolvedValue({
      deploymentContract: vi.fn(() => runtimeContract),
    });

    await buildDeploymentCommand('analytics/api.ts', {
      runtime: 'python',
      runtimeArtifact: digest,
      runtimeFile: 'dist/runtime.pyz',
    });

    expect(mockReadDeploymentRuntimeFile).toHaveBeenCalledWith('dist/runtime.pyz');
    expect(mockWriteDeploymentBundle).toHaveBeenCalledWith(
      'analytics/hypequery-deployment',
      expect.objectContaining({ contract: runtimeContract }),
      [{ runtime: 'python', sha256: digest, bytes }],
    );
  });

  it('rejects malformed runtime artifact identities before loading the API', async () => {
    await expect(buildDeploymentCommand('analytics/api.ts', {
      runtimeArtifact: 'not-a-sha',
    })).rejects.toThrow(/64-character SHA-256/);
    expect(mockLoadApiModule).not.toHaveBeenCalled();
  });

  it('requires an API with deployment contract support', async () => {
    mockLoadApiModule.mockResolvedValue({ handler: vi.fn() });
    await expect(buildDeploymentCommand('analytics/api.ts')).rejects.toThrow(
      /must provide deploymentContract\(\)/,
    );
  });

  it('requires a prebuilt artifact for Python handlers', async () => {
    mockLoadApiModule.mockResolvedValue({ deploymentContract: vi.fn() });
    mockGetDeploymentRuntimeEntrypoints.mockReturnValue(['greeting']);

    await expect(buildDeploymentCommand('analytics/api.ts', { runtime: 'python' }))
      .rejects.toThrow(/support Node only[\s\S]*--runtime-artifact/);
    expect(mockBuildNodeRuntimeArtifact).not.toHaveBeenCalled();
  });

  it('rejects runtime output paths that overwrite deployment metadata', async () => {
    mockLoadApiModule.mockResolvedValue({ deploymentContract: vi.fn(() => contract) });
    mockGetDeploymentRuntimeEntrypoints.mockReturnValue(['greeting']);
    mockBuildNodeRuntimeArtifact.mockResolvedValue({
      bytes: new Uint8Array(),
      artifactSha256: ARTIFACT_SHA,
      entrypointPrefix: 'queries',
      runtimeEntrypoints: ['greeting'],
    });

    await expect(buildDeploymentCommand('analytics/api.ts', {
      output: 'dist/deployment.json',
      runtimeOutput: 'dist/deployment.json',
    })).rejects.toThrow(/--runtime-output must use a different path from --output/);
    expect(mockLoadApiModule).not.toHaveBeenCalled();
    expect(mockBuildNodeRuntimeArtifact).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('does not emit a runtime artifact for Dataset-only APIs', async () => {
    const deploymentContract = vi.fn(() => contract);
    mockLoadApiModule.mockResolvedValue({ deploymentContract });

    await buildDeploymentCommand('analytics/api.ts', { output: 'dist/deployment.json' });

    expect(deploymentContract).toHaveBeenCalledWith({});
    expect(mockBuildNodeRuntimeArtifact).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalledWith(
      expect.stringContaining('runtime'),
      expect.anything(),
    );
  });

  it('validates an artifact and returns its immutable contract', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(contract));

    const result = await validateDeploymentCommand('dist/deployment.json');

    expect(result).toEqual(contract);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('validates a legacy JSON artifact reached through a symbolic link', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false, isFile: () => true } as never);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(contract));

    const result = await validateDeploymentCommand('dist/deployment-link.json');

    expect(result).toEqual(contract);
    expect(readFile).toHaveBeenCalledWith('dist/deployment-link.json', 'utf8');
  });

  it('verifies a deployment bundle directory', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never);
    mockVerifyDeploymentBundle.mockResolvedValue({
      directory: '/project/dist/bundle',
      manifest: {
        kind: 'hypequery-deployment-bundle',
        version: 1,
        deployment: {
          path: 'deployment.json',
          identity: '1'.repeat(64),
          sha256: '2'.repeat(64),
          byteLength: 1,
        },
        artifacts: [],
      },
      identity: '3'.repeat(64),
      contract,
    });

    const result = await validateDeploymentCommand('dist/bundle');

    expect(mockVerifyDeploymentBundle).toHaveBeenCalledWith('dist/bundle');
    expect(result).toBe(contract);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('reports bundle verification failures as invalid bundles', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => true } as never);
    mockVerifyDeploymentBundle.mockRejectedValue(new Error('manifest mismatch'));

    await expect(validateDeploymentCommand('dist/bundle')).rejects.toThrow(
      /Invalid deployment bundle: dist\/bundle[\s\S]*manifest mismatch/,
    );
  });

  it('reports special files as unsupported deployment inputs', async () => {
    vi.mocked(stat).mockResolvedValue({ isDirectory: () => false, isFile: () => false } as never);

    await expect(validateDeploymentCommand('dist/deployment.pipe')).rejects.toThrow(
      /Deployment input must be a regular JSON file or bundle directory: dist\/deployment\.pipe/,
    );
    expect(readFile).not.toHaveBeenCalled();
  });

  it('reports malformed JSON separately from contract validation', async () => {
    vi.mocked(readFile).mockResolvedValue('{');
    await expect(validateDeploymentCommand('broken.json')).rejects.toThrow(
      /Invalid deployment JSON: broken\.json/,
    );
  });

  it('includes the artifact path in contract validation errors', async () => {
    vi.mocked(readFile).mockResolvedValue('{}');
    await expect(validateDeploymentCommand('invalid.json')).rejects.toThrow(
      /Invalid deployment contract: invalid\.json[\s\S]*HQ_DEPLOYMENT_/,
    );
  });
});
